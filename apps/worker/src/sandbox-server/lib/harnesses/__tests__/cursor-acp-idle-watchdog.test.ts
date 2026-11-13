import { DEFAULT_OPENCODE_TURN_STALL_TIMEOUT_MS } from '../opencode-server/stall-watchdogs';
import { DEFAULT_IDLE_TIMEOUT_MS } from '../cursor-acp/create-turn-context';
import { IdleWatchdog } from '../cursor-acp/idle-watchdog';
import { stalledOutcome } from '../cursor-acp/turn-outcome';
import {
  startFakeCursorHarness,
  startTask,
  waitFor,
} from './cursor-acp-test-harness';

describe('IdleWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once the agent has been silent for the whole window', () => {
    const onIdle = vi.fn();
    new IdleWatchdog(1000, onIdle).start();

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('is pushed back by activity', () => {
    const onIdle = vi.fn();
    const watchdog = new IdleWatchdog(1000, onIdle);
    watchdog.start();

    vi.advanceTimersByTime(900);
    watchdog.touch();
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('waits while a command is still running, however silent it is', () => {
    const onIdle = vi.fn();
    let busy = true;
    new IdleWatchdog(1000, onIdle, () => busy).start();

    vi.advanceTimersByTime(3000);
    expect(onIdle).not.toHaveBeenCalled();

    busy = false;
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stops waiting for a command that never ends after four timeouts of silence', () => {
    const onIdle = vi.fn();
    new IdleWatchdog(1000, onIdle, () => true).start();

    vi.advanceTimersByTime(3999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('reports how long the agent really was silent, not just the window', () => {
    const onIdle = vi.fn();
    new IdleWatchdog(1000, onIdle, () => true).start();

    vi.advanceTimersByTime(4000);

    expect(onIdle).toHaveBeenCalledWith(4000);
  });

  it('counts the cap from the last message, not from the start', () => {
    const onIdle = vi.fn();
    const watchdog = new IdleWatchdog(1000, onIdle, () => true);
    watchdog.start();

    vi.advanceTimersByTime(3500);
    watchdog.touch();
    vi.advanceTimersByTime(3500);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('stalledOutcome', () => {
  it.each([
    [15 * 60_000, 'no output for 15 minutes'],
    [60 * 60_000, 'no output for 60 minutes'],
    [30_000, 'no output for 30 seconds'],
  ])('words %i ms of silence as "%s"', (silentMs, wording) => {
    expect(stalledOutcome(silentMs)).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining(wording),
    });
  });
});

it('waits as long as the OpenCode harness before calling a turn stalled', () => {
  expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(DEFAULT_OPENCODE_TURN_STALL_TIMEOUT_MS);
  expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(15 * 60_000);
});

describe('a long silent command', () => {
  const live: Array<Awaited<ReturnType<typeof startFakeCursorHarness>>> = [];
  afterEach(() => live.splice(0).forEach((fake) => fake.dispose()));

  it('is not mistaken for a stalled agent', async () => {
    const fake = await startFakeCursorHarness({
      env: {
        CURSOR_ACP_IDLE_TIMEOUT_MS: '150',
        FAKE_ACP_TOOL_MS: '400',
      },
    });
    live.push(fake);

    fake.harness.sendCommand(startTask('build [slowtool]'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(fake.timeline).not.toContain('task:taskAborted');
    expect(JSON.stringify(fake.persisted)).toContain('slow output');
  });

  it('still stalls a turn that is silent with no command running', async () => {
    const fake = await startFakeCursorHarness({
      env: { CURSOR_ACP_IDLE_TIMEOUT_MS: '100', FAKE_ACP_MODE: 'stall' },
    });
    live.push(fake);

    fake.harness.sendCommand(startTask('go'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));
  });
});
