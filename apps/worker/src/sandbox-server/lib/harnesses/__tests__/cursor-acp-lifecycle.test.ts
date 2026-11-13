import { ACP_LOGICAL_EVENT_ID_KEY } from '@roomote/types';

import { TaskCommandName } from '../../harness';
import {
  isAlive,
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

const count = (fake: Fake, label: string) =>
  fake.timeline.filter((l) => l === label).length;
const prompts = (fake: Fake) =>
  fake
    .agentLog()
    .filter((m) => m.method === 'session/prompt')
    .map((m) => m.params.prompt[0]!.text);
const send = (
  fake: Fake,
  data: { text: string; autoSteerWhenQueued?: boolean },
) =>
  fake.harness.sendCommand({ commandName: TaskCommandName.SendMessage, data });

describe('steering without native turn steering', () => {
  it('replays the prioritized prompt after an unattributed cancel, without reporting an abort', async () => {
    const fake = await start();
    fake.harness.sendCommand(startTask('long [hold]'));
    await waitFor(() => fake.live.length > 1);

    send(fake, { text: 'steer', autoSteerWhenQueued: true });
    fake.harness.sendCommand({
      commandName: TaskCommandName.PrioritizeQueuedMessage,
      data: { id: fake.harness.getQueuedMessageSnapshots!()[0]!.id },
    });
    fake.harness.sendCommand({ commandName: TaskCommandName.CancelTask });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);

    expect(prompts(fake)).toEqual(['long [hold]', 'steer']);
    expect(fake.timeline).not.toContain('task:taskAborted');
    expect(fake.harness.getQueuedMessages!()).toEqual([]);
  });

  it('drops the queue when a user stop is attributed', async () => {
    const fake = await start();
    fake.harness.sendCommand(startTask('long [hold]'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'queued' });

    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Pat' } },
    });
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(prompts(fake)).toEqual(['long [hold]']);
  });
});

describe('turn identity', () => {
  it('uses different logical event ids for the same session after a restart', async () => {
    const ids = async () => {
      const fake = await start({
        start: { initialSessionId: 'shared-session' },
      });
      send(fake, { text: 'again' });
      await waitFor(() => count(fake, 'task:taskCompleted') === 1);
      const message = fake.persisted.find((e) =>
        e.eventType.endsWith('assistant_message'),
      );
      return (message!.payload as Record<string, unknown>)[
        ACP_LOGICAL_EVENT_ID_KEY
      ];
    };

    const first = await ids();
    const second = await ids();

    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });
});

describe('queued prompt gate', () => {
  it('does not wedge the harness when the pre-delivery check throws', async () => {
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: {
        beforeQueuedPrompt: async () => {
          throw new Error('sdk unavailable');
        },
      },
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'held' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);
    await waitFor(() => fake.harness.getQueuedMessageSnapshots!().length === 1);

    send(fake, { text: 'direct' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 2);

    expect(prompts(fake)).toEqual(['first', 'direct']);
  });
});

describe('a user stop while a queued prompt awaits its check', () => {
  it('is not undone when the check then lets the prompt through', async () => {
    let release!: () => void;
    const check = new Promise<void>((resolve) => (release = resolve));
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: { beforeQueuedPrompt: () => check },
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'held' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);

    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Test User' } },
    });
    // The stop waits for the turn, which still awaits the check.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await waitFor(() => fake.timeline.includes('task:taskAborted'));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(prompts(fake)).toEqual(['first']);
    expect(fake.harness.getQueuedMessages!()).toEqual([]);
  });

  it('leaves no stop marker, since no turn was running', async () => {
    let release!: () => void;
    const check = new Promise<void>((resolve) => (release = resolve));
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: { beforeQueuedPrompt: () => check },
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'held' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);

    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Test User' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(JSON.stringify(fake.persisted)).not.toContain('Stopped by');
  });
});

describe('a steer while a queued prompt awaits its check', () => {
  it('runs the steer first and still delivers the prompt that was being checked', async () => {
    let release!: () => void;
    const firstCheck = new Promise<void>((resolve) => (release = resolve));
    let checks = 0;
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      // Only the first check (of 'held') is slow; the steer's passes at once.
      start: {
        beforeQueuedPrompt: async () => {
          if (checks++ === 0) await firstCheck;
        },
      },
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'held' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);
    await waitFor(() => checks === 1);

    // The user steers while 'held' is out of the queue awaiting its check.
    send(fake, { text: 'steer', autoSteerWhenQueued: true });
    fake.harness.sendCommand({ commandName: TaskCommandName.CancelTask });
    // The steer's cancel waits for the turn, which still awaits the check.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await waitFor(() => count(fake, 'task:taskCompleted') === 3);

    expect(prompts(fake)).toEqual(['first', 'steer', 'held']);
    expect(fake.timeline).not.toContain('task:taskAborted');
    expect(fake.harness.getQueuedMessages!()).toEqual([]);
  });
});

describe('closing the task while a queued prompt awaits its check', () => {
  it('drops the prompt instead of delivering it', async () => {
    let release!: () => void;
    const check = new Promise<void>((resolve) => (release = resolve));
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: { beforeQueuedPrompt: () => check },
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'held' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);

    fake.harness.sendCommand({ commandName: TaskCommandName.CloseTask });
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(prompts(fake)).toEqual(['first']);
    expect(fake.harness.getQueuedMessages!()).toEqual([]);
  });
});

describe('disposing the harness while a queued prompt awaits its check', () => {
  it('does not deliver the prompt to the agent that is going away', async () => {
    let release!: () => void;
    const check = new Promise<void>((resolve) => (release = resolve));
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: { beforeQueuedPrompt: () => check },
    });
    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    send(fake, { text: 'held' });
    await waitFor(() => count(fake, 'task:taskCompleted') === 1);

    fake.dispose();
    release();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(prompts(fake)).toEqual(['first']);
  });
});

describe('agent process environment', () => {
  it('passes only the runtime env plus a HOME fallback', async () => {
    process.env.CURSOR_TEST_PARENT_ONLY = 'leak';
    const fake = await start();
    delete process.env.CURSOR_TEST_PARENT_ONLY;

    const { spawnEnv } = fake.agentLog().find((m) => m.spawnEnv)!;
    expect(spawnEnv).toEqual({
      HOME: process.env.HOME,
      CURSOR_API_KEY: 'test-key',
    });
  });
});

describe('the agent process tree', () => {
  const childPid = (fake: Fake) =>
    fake.agentLog().find((m) => m.childPid)?.childPid;

  it('is stopped as a whole on dispose, so no stdio MCP server outlives the agent', async () => {
    const fake = await start({ env: { FAKE_ACP_SPAWN_CHILD: '1' } });
    await waitFor(() => childPid(fake) !== undefined);
    const pid = childPid(fake)!;
    expect(isAlive(pid)).toBe(true);

    fake.dispose();

    await waitFor(() => !isAlive(pid));
  });

  it('treats an agent that exited as gone even if a leftover child holds its stdout open', async () => {
    const fake = await start();
    fake.harness.sendCommand(startTask('go [exitkeep]'));

    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(fake.harness.isConnected).toBe(false);
    expect(
      fake.persisted.some((e) =>
        JSON.stringify(e.payload).includes('exited unexpectedly'),
      ),
    ).toBe(true);
    const pid = childPid(fake)!;
    fake.dispose();
    await waitFor(() => !isAlive(pid));
  });
});
