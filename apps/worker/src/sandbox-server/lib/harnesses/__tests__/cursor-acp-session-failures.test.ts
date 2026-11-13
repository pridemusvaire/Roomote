import { TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY } from '@roomote/types';

import { TaskCommandName } from '../../harness';
import { isPlaceholderSessionId } from '../cursor-acp/placeholder-session';
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

const prompts = (fake: Fake) =>
  fake.agentLog().filter((m) => m.method === 'session/prompt');
const events = (fake: Fake, name: string) =>
  fake.taskEvents.filter((e) => e.eventName === name);
const terminalText = (fake: Fake) =>
  fake.persisted.find((e) => e.metadata?.[TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY])
    ?.payload.text;
const cancel = (fake: Fake, cancelledBy?: { name: string }) =>
  fake.harness.sendCommand({
    commandName: TaskCommandName.CancelTask,
    data: cancelledBy ? { cancelledBy } : {},
  } as never);

describe('failures before a session exists', () => {
  it('reports each under its own placeholder id that is never resumable', async () => {
    const ids: string[] = [];

    for (let i = 0; i < 2; i++) {
      const fake = await start({ env: { FAKE_ACP_FAIL_NEW: '1' } });
      fake.harness.sendCommand(startTask('hi'));
      await waitFor(() => events(fake, 'taskAborted').length > 0);
      ids.push(events(fake, 'taskStarted')[0]!.payload[0] as string);
    }

    expect(new Set(ids).size).toBe(2);
    expect(ids.every(isPlaceholderSessionId)).toBe(true);
  });
});

describe('cancel while the session is still being created', () => {
  const slowNew = { FAKE_ACP_NEW_DELAY_MS: '300' };

  it('announces the late session before the abort, once', async () => {
    const fake = await start({ env: slowNew });

    fake.harness.sendCommand(startTask('hi'));
    cancel(fake, { name: 'Test User' });
    await waitFor(() => events(fake, 'taskAborted').length > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const names = fake.taskEvents.map((e) => e.eventName);
    expect(names.indexOf('taskStarted')).toBeLessThan(
      names.indexOf('taskAborted'),
    );
    expect(events(fake, 'taskAborted')).toHaveLength(1);
    expect(events(fake, 'taskStarted')[0]!.payload[0]).toBe(
      events(fake, 'taskAborted')[0]!.payload[0],
    );
    expect(prompts(fake)).toHaveLength(0);
  });

  it('delivers the queued steer once the session exists', async () => {
    const fake = await start({ env: slowNew });

    fake.harness.sendCommand(startTask('first'));
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'steer', autoSteerWhenQueued: true },
    });
    cancel(fake);
    await waitFor(() => events(fake, 'taskCompleted').length > 0);

    expect(prompts(fake).map((m) => m.params.prompt[0]!.text)).toEqual([
      expect.stringContaining('steer'),
    ]);
    expect(events(fake, 'taskAborted')).toHaveLength(0);
  });
});

describe('session setup timeouts', () => {
  const fast = { CURSOR_ACP_REQUEST_TIMEOUT_MS: '100' };

  it.each([
    ['session/new', { FAKE_ACP_STALL_NEW: '1' }, {}],
    [
      'session/set_model',
      { FAKE_ACP_STALL_SET_MODEL: '1' },
      { modelOverride: 'composer-2.5' },
    ],
  ])(
    'fails a stalled %s as a terminal error and restarts the agent',
    async (_name, env, startOptions) => {
      const fake = await start({
        env: { ...fast, ...env },
        start: startOptions,
      });
      const restarts: unknown[] = [];
      fake.harness.on('restartRequested', (r) => restarts.push(r));

      fake.harness.sendCommand(startTask('hi'));
      await waitFor(() => events(fake, 'taskAborted').length > 0);

      expect(terminalText(fake)).toContain('stopped responding');
      expect(restarts).toHaveLength(1);
      expect(fake.timeline.indexOf('task:taskStarted')).toBeLessThan(
        fake.timeline.indexOf('task:taskAborted'),
      );
    },
  );

  describe('a session/load that never answers', () => {
    const stalledLoad = {
      env: {
        CURSOR_ACP_LOAD_TIMEOUT_MS: '100',
        FAKE_ACP_STALL_LOAD: '1',
      },
      start: { initialSessionId: 'old-session' },
    };

    it('continues in a fresh session and says the context was lost', async () => {
      const fake = await start(stalledLoad);

      fake.harness.sendCommand(startTask('hi'));
      await waitFor(() => fake.timeline.includes('task:taskCompleted'));

      expect(fake.agentLog().some((m) => m.method === 'session/new')).toBe(
        true,
      );
      expect(JSON.stringify(fake.persisted)).toContain(
        'Prior Cursor context could not be restored',
      );
      expect(terminalText(fake)).toBeUndefined();
    });

    it('hands the conversation so far to the fresh session', async () => {
      const restoreContext = vi.fn(
        async (prompt: { text: string }) => `HISTORY for ${prompt.text}`,
      );
      const fake = await start({
        ...stalledLoad,
        start: { ...stalledLoad.start, restoreContext },
      });

      fake.harness.sendCommand(startTask('hi'));
      await waitFor(() => fake.timeline.includes('task:taskCompleted'));

      expect(restoreContext).toHaveBeenCalledWith({
        text: 'hi',
        hidden: false,
      });
      expect(prompts(fake)[0]!.params.prompt[0]!.text).toContain(
        'HISTORY for hi',
      );
      // Only what the agent receives carries the context, never the transcript.
      expect(
        fake.persisted
          .filter((e) => e.eventType === 'roomote_runtime.user_prompt')
          .map((e) => e.payload.text),
      ).toEqual(['hi']);
    });

    it('tells the restore a hidden prompt is not the user request', async () => {
      const restoreContext = vi.fn(async () => 'HISTORY');
      const fake = await start({
        ...stalledLoad,
        start: { ...stalledLoad.start, restoreContext },
      });

      fake.harness.sendCommand({
        commandName: TaskCommandName.StartNewTask,
        data: { text: 'send your reply', visibleInTranscript: false },
      });
      await waitFor(() => fake.timeline.includes('task:taskCompleted'));

      expect(restoreContext).toHaveBeenCalledWith({
        text: 'send your reply',
        hidden: true,
      });
    });

    it('still starts the fresh session when the history cannot be read', async () => {
      const fake = await start({
        ...stalledLoad,
        start: {
          ...stalledLoad.start,
          restoreContext: async () => {
            throw new Error('transcript unavailable');
          },
        },
      });

      fake.harness.sendCommand(startTask('hi'));
      await waitFor(() => fake.timeline.includes('task:taskCompleted'));

      expect(prompts(fake)).toHaveLength(1);
    });
  });

  it('gives session/load its own, longer timeout than the other setup requests', async () => {
    const fake = await start({
      env: {
        CURSOR_ACP_REQUEST_TIMEOUT_MS: '50',
        CURSOR_ACP_LOAD_TIMEOUT_MS: '2000',
        FAKE_ACP_LOAD_DELAY_MS: '300',
      },
      start: { initialSessionId: 'big-session' },
    });

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(fake.agentLog().some((m) => m.method === 'session/new')).toBe(false);
    expect(JSON.stringify(fake.persisted)).not.toContain(
      'could not be restored',
    );
  });
});

describe('a follow-up whose session cannot be started', () => {
  const brokenSession = {
    env: { FAKE_ACP_FAIL_LOAD: '1', FAKE_ACP_FAIL_NEW: '1' },
    start: { initialSessionId: 'old-session' },
  };
  const send = (fake: Fake) =>
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'and then?' },
    });

  it('ends the task with the reason instead of leaving it running', async () => {
    const fake = await start(brokenSession);

    send(fake);
    await waitFor(() => events(fake, 'taskAborted').length > 0);

    expect(terminalText(fake)).toContain(
      'Starting the Cursor agent session failed: Authentication required',
    );
    expect(events(fake, 'taskAborted')[0]!.payload[0]).toBe('old-session');
  });

  it('announces the session before the abort so the manager keeps the events', async () => {
    const fake = await start(brokenSession);

    send(fake);
    await waitFor(() => events(fake, 'taskAborted').length > 0);

    const names = fake.taskEvents.map((e) => e.eventName);
    expect(names.indexOf('taskStarted')).toBeLessThan(
      names.indexOf('taskAborted'),
    );
    expect(events(fake, 'taskStarted')[0]!.payload[0]).toBe('old-session');
  });

  it('reports under a placeholder when there was never a session', async () => {
    const fake = await start({ env: { FAKE_ACP_FAIL_NEW: '1' } });

    send(fake);
    await waitFor(() => events(fake, 'taskAborted').length > 0);

    expect(
      isPlaceholderSessionId(
        events(fake, 'taskAborted')[0]!.payload[0] as string,
      ),
    ).toBe(true);
    expect(terminalText(fake)).toContain('Authentication required');
  });
});

describe('an abandoned turn', () => {
  it('drops updates tagged with another session', async () => {
    const fake = await start();

    fake.harness.sendCommand(startTask('go [stale]'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(JSON.stringify(fake.persisted)).not.toContain('STALE LEFTOVER');
    expect(JSON.stringify(fake.persisted)).toContain('reply: go');
  });

  it('restarts the agent instead of prompting a session still busy', async () => {
    const fake = await start({
      env: {
        CURSOR_ACP_IDLE_TIMEOUT_MS: '100',
        CURSOR_ACP_CANCEL_GRACE_MS: '100',
      },
    });
    const restarts: unknown[] = [];
    fake.harness.on('restartRequested', (r) => restarts.push(r));

    fake.harness.sendCommand(startTask('go [stall]'));
    await waitFor(() => terminalText(fake) !== undefined);
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'again' },
    });
    await waitFor(() => restarts.length > 0);

    expect(prompts(fake)).toHaveLength(1);
  });

  it('waits for the old request to settle before prompting again', async () => {
    const fake = await start({
      env: {
        CURSOR_ACP_CANCEL_GRACE_MS: '200',
        FAKE_ACP_CANCEL_DELAY_MS: '280',
      },
    });

    fake.harness.sendCommand(startTask('go [hold]'));
    await waitFor(() => fake.live.length > 1);
    cancel(fake, { name: 'Test User' });
    await waitFor(() => events(fake, 'taskAborted').length > 0);
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'again' },
    });
    await waitFor(() => prompts(fake).length === 2);

    const order = fake
      .agentLog()
      .flatMap((m) =>
        'promptSettled' in m
          ? ['settled']
          : m.method === 'session/prompt'
            ? ['prompt']
            : [],
      );
    expect(order).toEqual(['prompt', 'settled', 'prompt']);
  });
});
