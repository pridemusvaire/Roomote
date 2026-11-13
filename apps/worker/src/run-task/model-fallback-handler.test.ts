const { applyModelFallbackMock, findFirstByIdMock } = vi.hoisted(() => ({
  applyModelFallbackMock: vi.fn(),
  findFirstByIdMock: vi.fn(),
}));

vi.mock('@roomote/sdk/client', () => ({
  sdk: {
    taskRuns: {
      applyModelFallback: applyModelFallbackMock,
      findFirstById: findFirstByIdMock,
    },
  },
}));

import { TaskCommandName } from '../sandbox-server/lib/harness';

import { createModelFallbackHandler } from './model-fallback-handler';
import type { ModelEnvReload } from './reload-model-provider-env';

const logger = {
  runId: 1,
  filePath: '/dev/null',
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
};

const request = (fromModelId: string) =>
  ({
    role: 'coding',
    fromModelId,
    toModelId: 'openai/gpt-5',
    toReasoningEffort: null,
    errorSummary: 'limit',
    trigger: 'immediate',
    sessionId: 's1',
  }) as const;

function setup(options?: { snapshotWaitMs?: number }) {
  const cancel = new AbortController();
  const reloadModelProviderEnv = vi.fn(
    async (_options: {
      waitForSnapshot: { signal: AbortSignal };
    }): Promise<ModelEnvReload> => 'reloaded',
  );
  const harness = {
    requestReconnect: vi.fn(async () => {}),
    sendCommand: vi.fn(() => true),
    failTask: vi.fn(),
  };
  const taskRun = { id: 7, taskId: 'task-7', payload: {} };
  const handle = createModelFallbackHandler({
    harness: harness as never,
    taskRun: taskRun as never,
    logger,
    reloadModelProviderEnv,
    cancelSignal: cancel.signal,
    ...options,
  });

  return { harness, taskRun, handle, reloadModelProviderEnv, cancel };
}

describe('createModelFallbackHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstByIdMock.mockResolvedValue({ payload: { fresh: true } });
  });

  it('refreshes the provider env of the fallback model before the respawn that uses it', async () => {
    applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
    const { harness, handle, reloadModelProviderEnv } = setup();
    const order: string[] = [];
    reloadModelProviderEnv.mockImplementation(async () => {
      order.push('reload');
      return 'reloaded';
    });
    harness.requestReconnect.mockImplementation(async () => {
      order.push('reconnect');
    });

    await handle(request('openai/gpt-4'));

    expect(order).toEqual(['reload', 'reconnect']);
  });

  it('applies the fallback, reloads the payload and reconnects with the recovery message to replay', async () => {
    applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
    const { harness, taskRun, handle } = setup();

    await handle(request('openai/gpt-4'));

    expect(applyModelFallbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 7, toModelId: 'openai/gpt-5' }),
    );
    expect(taskRun.payload).toEqual({ fresh: true });
    expect(harness.requestReconnect).toHaveBeenCalledTimes(1);
    // The harness owns the message, so a user stop can still take it back.
    expect(harness.requestReconnect).toHaveBeenCalledWith({
      reason: 'Switching to fallback model',
      replayCommands: [
        expect.objectContaining({ commandName: TaskCommandName.SendMessage }),
      ],
    });
    expect(harness.sendCommand).not.toHaveBeenCalled();
    expect(harness.failTask).not.toHaveBeenCalled();
  });

  it('waits for a snapshot only until the task is cancelled', async () => {
    applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
    const { reloadModelProviderEnv, handle, cancel } = setup();

    await handle(request('openai/gpt-4'));

    const { signal } = reloadModelProviderEnv.mock.calls[0]![0].waitForSnapshot;
    expect(signal.aborted).toBe(false);
    cancel.abort();
    expect(signal.aborted).toBe(true);
  });

  it('ends the task, with the reason, when the snapshot outlasts the deadline', async () => {
    applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
    const { harness, handle, reloadModelProviderEnv } = setup({
      snapshotWaitMs: 20,
    });
    reloadModelProviderEnv.mockImplementation(
      async ({ waitForSnapshot: { signal } }) =>
        await new Promise<'snapshot'>((resolve) =>
          signal.addEventListener('abort', () => resolve('snapshot')),
        ),
    );

    await handle(request('cursor/composer-2.5'));

    expect(harness.failTask).toHaveBeenCalledWith(
      expect.stringContaining('openai/gpt-5'),
    );
    expect(harness.failTask).toHaveBeenCalledWith(
      expect.stringContaining('snapshot'),
    );
    expect(harness.requestReconnect).not.toHaveBeenCalled();
    expect(harness.sendCommand).not.toHaveBeenCalled();
  });

  it('lets a cancelled task go without a failure notice or a respawn', async () => {
    applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
    const { harness, handle, reloadModelProviderEnv, cancel } = setup();
    reloadModelProviderEnv.mockImplementation(async () => {
      cancel.abort();
      return 'snapshot';
    });

    await handle(request('cursor/composer-2.5'));

    expect(harness.failTask).not.toHaveBeenCalled();
    expect(harness.requestReconnect).not.toHaveBeenCalled();
  });

  it('ends the task when the respawn after a failed persist throws too', async () => {
    applyModelFallbackMock.mockRejectedValue(new Error('db down'));
    const { harness, handle } = setup();
    harness.requestReconnect.mockRejectedValue(new Error('spawn failed'));

    await handle(request('openai/gpt-4'));

    expect(harness.failTask).toHaveBeenCalledWith(
      expect.stringContaining('spawn failed'),
    );
  });

  it('ends the task when the respawn onto the fallback model throws', async () => {
    applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
    const { harness, handle } = setup();
    harness.requestReconnect.mockRejectedValue(new Error('spawn failed'));

    await handle(request('openai/gpt-4'));

    expect(harness.failTask).toHaveBeenCalledWith(
      expect.stringContaining('spawn failed'),
    );
  });

  it('recovers on the same model when applying an OpenCode fallback fails', async () => {
    applyModelFallbackMock.mockRejectedValue(new Error('db down'));
    const { harness, handle } = setup();

    await handle(request('openai/gpt-4'));

    expect(harness.requestReconnect).toHaveBeenCalledTimes(1);
    expect(harness.requestReconnect).toHaveBeenCalledWith({
      reason: 'Recovering after model fallback failed to persist',
      replayCommands: [
        expect.objectContaining({ commandName: TaskCommandName.SendMessage }),
      ],
    });
    expect(harness.failTask).not.toHaveBeenCalled();
  });

  it('ends the task instead of respawning on Cursor when its fallback fails to apply', async () => {
    applyModelFallbackMock.mockRejectedValue(new Error('db down'));
    const { harness, handle } = setup();

    await handle(request('cursor/composer-2.5'));

    expect(harness.failTask).toHaveBeenCalledWith(
      expect.stringContaining('openai/gpt-5'),
    );
    expect(harness.failTask).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
    );
    expect(harness.requestReconnect).not.toHaveBeenCalled();
    expect(harness.sendCommand).not.toHaveBeenCalled();
  });

  // A Cursor harness stays `switching` (queuing every message) until it is
  // replaced or the task ends, so a served switch must always do one of the two.
  describe.each<[string, (ctx: ReturnType<typeof setup>) => void]>([
    ['applies cleanly', () => {}],
    [
      'fails to persist',
      () => applyModelFallbackMock.mockRejectedValue(new Error('db down')),
    ],
    [
      'cannot refresh the provider env',
      ({ reloadModelProviderEnv }) =>
        reloadModelProviderEnv.mockResolvedValue('failed'),
    ],
    [
      'is held up by a snapshot',
      ({ reloadModelProviderEnv }) =>
        reloadModelProviderEnv.mockResolvedValue('snapshot'),
    ],
    [
      'cannot respawn',
      ({ harness }) =>
        harness.requestReconnect.mockRejectedValue(new Error('spawn failed')),
    ],
  ])('a Cursor fallback that %s', (_name, arrange) => {
    it('ends in a replacement harness or in the end of the task', async () => {
      applyModelFallbackMock.mockResolvedValue({ status: 'applied' });
      const ctx = setup();
      arrange(ctx);

      await ctx.handle(request('cursor/composer-2.5'));

      const reconnected = ctx.harness.requestReconnect.mock.calls.length > 0;
      const failed = ctx.harness.failTask.mock.calls.length > 0;
      expect(reconnected || failed).toBe(true);
    });
  });

  it('ignores the orchestration role', async () => {
    const { harness, handle } = setup();

    await handle({
      ...request('openai/gpt-4'),
      role: 'orchestration',
    } as never);

    expect(applyModelFallbackMock).not.toHaveBeenCalled();
    expect(harness.requestReconnect).not.toHaveBeenCalled();
  });
});
