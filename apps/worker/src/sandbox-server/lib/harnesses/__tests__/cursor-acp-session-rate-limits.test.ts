import { TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY } from '@roomote/types';

import { TaskCommandName } from '../../harness';
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

const backoff = { CURSOR_ACP_RATE_LIMIT_BACKOFF_MS: '20,20,20' };
const requests = (fake: Fake, method: string) =>
  fake.agentLog().filter((m) => m.method === method);
const terminalText = (fake: Fake) =>
  fake.persisted.find((e) => e.metadata?.[TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY])
    ?.payload.text;
const done = (fake: Fake) =>
  waitFor(
    () =>
      fake.timeline.includes('task:taskCompleted') ||
      fake.timeline.includes('task:taskAborted'),
  );

describe('a rate limit on session/new', () => {
  it('is retried with backoff until the session is created', async () => {
    const fake = await start({
      env: { ...backoff, FAKE_ACP_RATE_LIMIT_NEW: '2' },
    });

    fake.harness.sendCommand(startTask('hi'));
    await done(fake);

    expect(requests(fake, 'session/new')).toHaveLength(3);
    expect(fake.timeline).toContain('task:taskCompleted');
    expect(terminalText(fake)).toBeUndefined();
  });

  it('fails the task as a provider error once the budget is spent', async () => {
    const fake = await start({
      env: { ...backoff, FAKE_ACP_RATE_LIMIT_NEW: '99' },
    });

    fake.harness.sendCommand(startTask('hi'));
    await done(fake);

    expect(requests(fake, 'session/new')).toHaveLength(4);
    expect(terminalText(fake)).toContain('Rate limited');
  });

  it('stops retrying when the task is cancelled', async () => {
    const fake = await start({
      env: {
        CURSOR_ACP_RATE_LIMIT_BACKOFF_MS: '200,200,200',
        FAKE_ACP_RATE_LIMIT_NEW: '99',
      },
    });

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => requests(fake, 'session/new').length === 1);
    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Test User' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(requests(fake, 'session/new')).toHaveLength(1);
    expect(terminalText(fake)).toBeUndefined();
  });
});

describe('a rate limit on session/load', () => {
  const resumed = { start: { initialSessionId: 'old-session' } };

  it('is retried, so the session is restored and not replaced', async () => {
    const fake = await start({
      env: { ...backoff, FAKE_ACP_RATE_LIMIT_LOAD: '2' },
      ...resumed,
    });

    fake.harness.sendCommand(startTask('continue'));
    await done(fake);

    expect(requests(fake, 'session/load')).toHaveLength(3);
    expect(requests(fake, 'session/new')).toHaveLength(0);
    expect(requests(fake, 'session/prompt')[0]!.params.sessionId).toBe(
      'old-session',
    );
  });

  it('fails the task instead of silently dropping the context once the budget is spent', async () => {
    const fake = await start({
      env: { ...backoff, FAKE_ACP_RATE_LIMIT_LOAD: '99' },
      ...resumed,
    });

    fake.harness.sendCommand(startTask('continue'));
    await done(fake);

    expect(requests(fake, 'session/load')).toHaveLength(4);
    expect(requests(fake, 'session/new')).toHaveLength(0);
    expect(terminalText(fake)).toContain('Rate limited');
  });
});

describe('a rate limit on session/set_model that a stop or close interrupts', () => {
  const waiting = () =>
    start({
      env: {
        CURSOR_ACP_RATE_LIMIT_BACKOFF_MS: '60000',
        FAKE_ACP_FAIL_SET_MODEL: 'RATE_LIMITED',
      },
      start: { modelOverride: 'composer-2.5' },
    });
  const startedWaiting = async () => {
    const fake = await waiting();

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => requests(fake, 'session/set_model').length === 1);
    return fake;
  };

  it('ends quietly on a stop instead of reporting a terminal error', async () => {
    const fake = await startedWaiting();

    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Test User' } },
    });
    await waitFor(() => fake.timeline.includes('task:taskAborted'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(terminalText(fake)).toBeUndefined();
    expect(JSON.stringify(fake.persisted)).toContain('Stopped by Test User');
  });

  it('ends silently on dispose instead of reporting a terminal error', async () => {
    const fake = await startedWaiting();

    fake.harness.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(terminalText(fake)).toBeUndefined();
  });
});
