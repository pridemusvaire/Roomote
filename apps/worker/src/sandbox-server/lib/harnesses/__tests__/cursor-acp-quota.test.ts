import { TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY } from '@roomote/types';

import { TaskCommandName } from '../../harness';
import { CONTINUE_AFTER_RATE_LIMIT_PROMPT } from '../cursor-acp/send-prompt';
import {
  startFakeCursorHarness,
  startTask,
  waitFor,
} from './cursor-acp-test-harness';

type Fake = Awaited<ReturnType<typeof startFakeCursorHarness>>;

const live: Fake[] = [];
async function start(...args: Parameters<typeof startFakeCursorHarness>) {
  const fake = await startFakeCursorHarness(...args);
  live.push(fake);
  return fake;
}
afterEach(() => live.splice(0).forEach((fake) => fake.dispose()));

const fallback = {
  fallbackModel: 'xai/grok-4.7',
  fallbackRole: 'coding',
  activeModelId: 'cursor/composer-2.5',
  fallbackReasoningEffort: 'high',
} as const;
const prompts = (fake: Fake) =>
  fake.agentLog().filter((m) => m.method === 'session/prompt');
const promptTexts = (fake: Fake) =>
  prompts(fake).map((m) => m.params.prompt[0]!.text);
/** The manager drops events under an id it was never told about. */
function expectStartedBeforeAborted(fake: Fake, aborts = true) {
  const names = fake.taskEvents.map((e) => e.eventName);
  const started = fake.taskEvents.find((e) => e.eventName === 'taskStarted');

  expect(started).toBeDefined();

  if (!aborts) {
    return;
  }

  const aborted = fake.taskEvents.find((e) => e.eventName === 'taskAborted');
  expect(names.indexOf('taskStarted')).toBeLessThan(
    names.indexOf('taskAborted'),
  );
  expect(started!.payload[0]).toBe(aborted!.payload[0]);
}
const terminalError = (fake: Fake) =>
  fake.persisted.find((e) => e.metadata?.[TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY]);

describe('Cursor plan-limit failures', () => {
  it('requests the coding fallback instead of retrying when one is configured', async () => {
    const fake = await start({
      start: { modelOverride: 'composer-2.5', ...fallback },
    });
    const requests: unknown[] = [];
    fake.harness.on('modelFallbackRequested', (r) => requests.push(r));

    fake.harness.sendCommand(startTask('build it [quota]'));
    await waitFor(() => requests.length > 0);

    expect(requests).toEqual([
      expect.objectContaining({
        role: 'coding',
        fromModelId: 'cursor/composer-2.5',
        toModelId: 'xai/grok-4.7',
        toReasoningEffort: 'high',
        trigger: 'immediate',
        errorSummary: expect.stringContaining('usage limit'),
      }),
    ]);
    expect(prompts(fake)).toHaveLength(1);
    expect(terminalError(fake)).toBeUndefined();
    expect(JSON.stringify(fake.persisted)).toContain(
      'Switching to xai/grok-4.7',
    );
    expect(fake.harness.isConnected).toBe(true);
  });

  it('sends an error summary the router accepts, however long the error is', async () => {
    const fake = await start({
      env: {
        FAKE_ACP_QUOTA_ERROR: JSON.stringify({
          code: 'USAGE_LIMIT_EXCEEDED',
          message: `You have reached your usage limit. ${'More details. '.repeat(60)}`,
        }),
      },
      start: { modelOverride: 'composer-2.5', ...fallback },
    });
    const requests: Array<{ errorSummary: string }> = [];
    fake.harness.on('modelFallbackRequested', (r) => requests.push(r));

    fake.harness.sendCommand(startTask('build it [quota]'));
    await waitFor(() => requests.length > 0);

    expect(requests[0]!.errorSummary.length).toBeLessThanOrEqual(280);
    expect(requests[0]!.errorSummary).toContain('usage limit');
  });

  it('asks for a fallback once per model even when the replacement harness hits the limit again', async () => {
    const attempts = new Set<string>();
    const options = {
      modelOverride: 'composer-2.5',
      ...fallback,
      fallbackAttempts: attempts,
    };
    const first = await start({ start: options });
    const requests = vi.fn();
    first.harness.on('modelFallbackRequested', requests);

    first.harness.sendCommand(startTask('build it [quota]'));
    await waitFor(() => requests.mock.calls.length > 0);

    // The switch could not be applied, so the worker respawned Cursor.
    const second = await start({ start: options });
    second.harness.on('modelFallbackRequested', requests);
    second.harness.sendCommand(startTask('build it [quota]'));
    await waitFor(() => second.timeline.includes('task:taskAborted'));

    expect(requests).toHaveBeenCalledTimes(1);
    expect(terminalError(second)!.payload.text).toContain(
      'Cursor plan limit reached',
    );
  });

  describe('a prompt the model never saw', () => {
    const replayed = (fake: Fake) => {
      const requests: Array<{ replayPrompt?: { text: string } }> = [];
      fake.harness.on('modelFallbackRequested', (r) => requests.push(r));
      return requests;
    };

    it('is replayed on the fallback when session/new hits the plan limit', async () => {
      const fake = await start({
        env: {
          FAKE_ACP_FAIL_NEW: JSON.stringify({
            code: 'USAGE_LIMIT_EXCEEDED',
            message: 'Quota exceeded for your plan',
          }),
        },
        start: { modelOverride: 'composer-2.5', ...fallback },
      });
      const requests = replayed(fake);

      fake.harness.sendCommand(startTask('build it'));
      await waitFor(() => requests.length > 0);

      expect(requests[0]!.replayPrompt).toMatchObject({ text: 'build it' });
      expectStartedBeforeAborted(fake, false);
    });

    it('is replayed, hidden, when set_model hits the plan limit', async () => {
      const fake = await start({
        env: { FAKE_ACP_FAIL_SET_MODEL: 'You have reached your usage limit' },
        start: { modelOverride: 'composer-2.5', ...fallback },
      });
      const requests = replayed(fake);

      fake.harness.sendCommand(startTask('build it'));
      await waitFor(() => requests.length > 0);

      expect(requests[0]!.replayPrompt).toMatchObject({
        text: 'build it',
        visibleInTranscript: false,
      });
      expect(prompts(fake)).toHaveLength(0);
    });

    it('is not replayed when the plan limit hits mid-turn', async () => {
      const fake = await start({
        start: { modelOverride: 'composer-2.5', ...fallback },
      });
      const requests = replayed(fake);

      fake.harness.sendCommand(startTask('build it [quota]'));
      await waitFor(() => requests.length > 0);

      expect(requests[0]!.replayPrompt).toBeUndefined();
    });
  });

  it('ends with a terminal error and never retries when no fallback is configured', async () => {
    const fake = await start({ start: { modelOverride: 'composer-2.5' } });
    const requests = vi.fn();
    fake.harness.on('modelFallbackRequested', requests);

    fake.harness.sendCommand(startTask('build it [quota]'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(terminalError(fake)!.payload.text).toBe(
      "Cursor plan limit reached for composer-2.5. Check your Cursor plan's usage, or set a coding fallback model so tasks can continue when it runs out.",
    );
    expect(
      fake.taskEvents.some(
        (e) =>
          (e.payload[0] as { message?: { say?: string } })?.message?.say ===
          'terminal_provider_error',
      ),
    ).toBe(true);
    expect(requests).not.toHaveBeenCalled();
    expect(prompts(fake)).toHaveLength(1);
  });

  it('keeps the queue for the replacement harness when it falls back', async () => {
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: fallback,
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'keep me [quota]' },
    });
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'later' },
    });
    const requested = new Promise((resolve) =>
      fake.harness.on('modelFallbackRequested', resolve),
    );

    await requested;

    expect(
      fake.harness.getQueuedMessageSnapshots!().map((m) => m.text),
    ).toEqual(['later']);
  });

  describe('while the switch to the fallback model is pending', () => {
    const pending = async () => {
      const fake = await start({
        start: { modelOverride: 'composer-2.5', ...fallback },
      });
      const requested = new Promise((resolve) =>
        fake.harness.on('modelFallbackRequested', resolve),
      );

      fake.harness.sendCommand(startTask('build it [quota]'));
      await requested;
      return fake;
    };
    const queuedTexts = (fake: Fake) =>
      fake.harness.getQueuedMessageSnapshots!().map((m) => m.text);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

    it('queues a message for the replacement harness instead of sending it to the exhausted model', async () => {
      const fake = await pending();

      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text: 'sent during the switch' },
      });
      await settle();

      expect(prompts(fake)).toHaveLength(1);
      expect(queuedTexts(fake)).toEqual(['sent during the switch']);
      expect(terminalError(fake)).toBeUndefined();
    });

    it('keeps a steer in the queue when its cancel arrives', async () => {
      const fake = await pending();

      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text: 'steer', autoSteerWhenQueued: true },
      });
      fake.harness.sendCommand({ commandName: TaskCommandName.CancelTask });
      await settle();

      expect(prompts(fake)).toHaveLength(1);
      expect(queuedTexts(fake)).toEqual(['steer']);
    });

    it('keeps the switch pending through a user stop: it drops the queue, and a later message waits for the replacement instead of running on the exhausted model', async () => {
      const fake = await pending();
      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text: 'stopped with the switch' },
      });

      fake.harness.sendCommand({
        commandName: TaskCommandName.CancelTask,
        data: { cancelledBy: { name: 'Test User', source: 'web' } },
      });
      await waitFor(() => fake.timeline.includes('task:taskAborted'));
      expect(queuedTexts(fake)).toEqual([]);

      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text: 'after the stop' },
      });
      await settle();

      expect(prompts(fake)).toHaveLength(1);
      expect(queuedTexts(fake)).toEqual(['after the stop']);
    });

    it('does not end the switch on a steer, which only reorders the queue', async () => {
      const fake = await pending();

      fake.harness.sendCommand({ commandName: TaskCommandName.CancelTask });
      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text: 'still waiting' },
      });
      await settle();

      expect(prompts(fake)).toHaveLength(1);
      expect(queuedTexts(fake)).toEqual(['still waiting']);
    });
  });

  it('never reclassifies a normal agent message that mentions a limit', async () => {
    const fake = await start();
    const requests = vi.fn();
    fake.harness.on('modelFallbackRequested', requests);

    fake.harness.sendCommand(startTask('go [quotatext]'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(terminalError(fake)).toBeUndefined();
    expect(requests).not.toHaveBeenCalled();
  });

  it('fails a refusal as an ordinary provider error, not a plan limit', async () => {
    const fake = await start();

    fake.harness.sendCommand(startTask('go [quotarefuse]'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(terminalError(fake)!.payload.text).toContain('refused');
    expect(terminalError(fake)!.payload.text).not.toContain('plan limit');
  });

  describe('transient rate limits', () => {
    const backoff = { CURSOR_ACP_RATE_LIMIT_BACKOFF_MS: '20,20,20' };

    it('retries the prompt with backoff until it succeeds', async () => {
      const fake = await start({
        env: { ...backoff, FAKE_ACP_RATE_LIMITS: '2' },
      });

      fake.harness.sendCommand(startTask('go [ratelimit]'));
      await waitFor(() => fake.timeline.includes('task:taskCompleted'));

      expect(prompts(fake)).toHaveLength(3);
      expect(new Set(promptTexts(fake))).toEqual(new Set(['go [ratelimit]']));
      expect(terminalError(fake)).toBeUndefined();
    });

    it('only nudges the agent to continue once work has already run, so side effects are not repeated', async () => {
      const fake = await start({
        env: {
          ...backoff,
          FAKE_ACP_RATE_LIMITS: '2',
          FAKE_ACP_MODE: 'ratelimittool',
        },
      });

      fake.harness.sendCommand(startTask('ship it'));
      await waitFor(() => fake.timeline.includes('task:taskCompleted'));

      expect(promptTexts(fake)).toEqual([
        'ship it',
        CONTINUE_AFTER_RATE_LIMIT_PROMPT,
        CONTINUE_AFTER_RATE_LIMIT_PROMPT,
      ]);
      expect(terminalError(fake)).toBeUndefined();
    });

    it('fails as a normal provider error once the budget is spent', async () => {
      const fake = await start({
        env: { ...backoff, FAKE_ACP_RATE_LIMITS: '99' },
        start: { modelOverride: 'composer-2.5', ...fallback },
      });
      const requests = vi.fn();
      fake.harness.on('modelFallbackRequested', requests);

      fake.harness.sendCommand(startTask('go [ratelimit]'));
      await waitFor(() => fake.timeline.includes('task:taskAborted'));

      expect(prompts(fake)).toHaveLength(4);
      expect(terminalError(fake)!.payload.text).toContain('Rate limit');
      expect(requests).not.toHaveBeenCalled();
    });

    it('stops retrying when the task is cancelled', async () => {
      const fake = await start({
        env: {
          CURSOR_ACP_RATE_LIMIT_BACKOFF_MS: '60000',
          FAKE_ACP_RATE_LIMITS: '99',
        },
      });

      fake.harness.sendCommand(startTask('go [ratelimit]'));
      await waitFor(() => prompts(fake).length === 1);
      fake.harness.sendCommand({
        commandName: TaskCommandName.CancelTask,
        data: { cancelledBy: { name: 'Test User' } },
      });
      await waitFor(() => fake.timeline.includes('task:taskAborted'));
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(prompts(fake)).toHaveLength(1);
    });
  });

  it('classifies a session/new limit error as a plan-limit failure', async () => {
    const fake = await start({
      env: {
        FAKE_ACP_FAIL_NEW: JSON.stringify({
          code: 'USAGE_LIMIT_EXCEEDED',
          message: 'Quota exceeded for your plan',
        }),
      },
    });

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(terminalError(fake)!.payload.text).toContain('plan limit reached');
    expectStartedBeforeAborted(fake);
  });

  it('keeps unrelated session errors on the generic failure path', async () => {
    const fake = await start({ env: { FAKE_ACP_FAIL_NEW: '1' } });

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(terminalError(fake)!.payload.text).toContain(
      'Authentication required',
    );
    expectStartedBeforeAborted(fake);
  });

  it('drops messages queued behind a session that could not start, as any other terminal failure does', async () => {
    const fake = await start({
      env: { FAKE_ACP_FAIL_NEW: '1', FAKE_ACP_NEW_DELAY_MS: '100' },
    });

    fake.harness.sendCommand(startTask('hi'));
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'queued behind it' },
    });
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(fake.harness.getQueuedMessages!()).toEqual([]);
  });
});
