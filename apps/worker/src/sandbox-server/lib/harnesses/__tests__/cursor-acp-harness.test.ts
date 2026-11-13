import { TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY } from '@roomote/types';

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

const idle = (fake: Fake, count = 1) =>
  waitFor(
    () =>
      fake.timeline.filter((l) => l === 'task:taskCompleted').length >= count,
  );
const prompts = (fake: Fake) =>
  fake
    .agentLog()
    .filter((m) => m.method === 'session/prompt')
    .map((m) => m.params.prompt[0]!.text);
const terminalError = (fake: Fake) =>
  fake.persisted.find((e) => e.metadata?.[TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY]);

describe('CursorAcpHarness turns', () => {
  it('emits the full envelope sequence for one turn', async () => {
    const fake = await start();
    expect(fake.harness.isConnected).toBe(true);
    expect(fake.harness.supportsNativeTurnSteering).toBe(false);

    fake.harness.sendCommand(startTask('hello'));
    await idle(fake);

    expect(fake.timeline).toEqual([
      'task:taskStarted',
      'live:roomote_runtime.user_prompt',
      'persisted:roomote_runtime.user_prompt',
      // The task has a secret (its Cursor key), so each live chunk is shown
      // in two parts: the safe head, then the tail held back at segment end.
      'live:roomote_runtime.assistant_thought_chunk',
      'live:roomote_runtime.assistant_message_chunk',
      'live:roomote_runtime.assistant_thought_chunk',
      'live:roomote_runtime.assistant_message_chunk',
      'persisted:roomote_runtime.assistant_thought',
      'persisted:roomote_runtime.assistant_message',
      'turn_completed',
      'task:taskCompleted',
    ]);
    const message = fake.persisted.find(
      (e) => e.eventType === 'roomote_runtime.assistant_message',
    );
    expect(message!.payload.text).toBe('reply: hello');
    expect(message!.contentBlocks).toEqual([
      { type: 'text', text: 'reply: hello' },
    ]);
  });

  it('maps a tool call to tool_call, tool_call_update and a persisted tool_result', async () => {
    const fake = await start();

    fake.harness.sendCommand(startTask('go [tool]'));
    await idle(fake);

    const types = fake.timeline.filter((l) => l.includes('tool'));
    expect(types).toEqual([
      'live:roomote_runtime.tool_call',
      'persisted:roomote_runtime.tool_call',
      'live:roomote_runtime.tool_call_update',
      'persisted:roomote_runtime.tool_result',
    ]);
    const result = fake.persisted.find(
      (e) => e.eventType === 'roomote_runtime.tool_result',
    );
    expect(JSON.stringify(result!.contentBlocks)).toContain('a.txt');
    expect(result!.metadata).toMatchObject({
      toolCallId: 'tc-1',
      status: 'completed',
    });
  });

  it('answers permission requests with the allow_always option', async () => {
    const fake = await start();

    fake.harness.sendCommand(startTask('x [permission]'));
    await idle(fake);

    expect(
      fake.agentLog().find((m) => m.permissionReply)?.permissionReply,
    ).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-always' } });
  });

  it('passes the workspace and mapped MCP servers to session/new', async () => {
    const fake = await start({
      start: {
        mcpServers: {
          roomote: { type: 'stdio', command: 'node', args: ['s.js'], env: {} },
        },
      },
    });

    fake.harness.sendCommand(startTask('hi'));
    await idle(fake);

    const created = fake.agentLog().find((m) => m.method === 'session/new');
    expect(created!.params.mcpServers).toEqual([
      { name: 'roomote', command: 'node', args: ['s.js'], env: [] },
    ]);
    expect(created!.params.cwd).toEqual(expect.stringContaining('cursor-acp-'));
  });
});

describe('CursorAcpHarness model selection', () => {
  it('sets the listed non-fast variant of the requested model before prompting', async () => {
    const fake = await start({ start: { modelOverride: 'composer-2.5' } });

    fake.harness.sendCommand(startTask('hi'));
    await idle(fake);

    const methods = fake.agentLog().map((m) => m.method);
    expect(methods.indexOf('session/set_model')).toBeLessThan(
      methods.indexOf('session/prompt'),
    );
    expect(
      fake.agentLog().find((m) => m.method === 'session/set_model')!.params
        .modelId,
    ).toBe('composer-2.5[fast=false]');
  });

  it('fails with the available ids and never prompts when the model is missing', async () => {
    const fake = await start({
      env: { FAKE_ACP_OMIT_MODEL: 'composer-2.5' },
      start: { modelOverride: 'composer-2.5' },
    });

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    const error = terminalError(fake);
    expect(error!.payload.text).toContain('composer-2.5');
    expect(error!.payload.text).toContain('default[]');
    expect(prompts(fake)).toEqual([]);
    expect(fake.timeline).toContain('task:taskAborted');
    expect(fake.timeline).not.toContain('task:taskCompleted');
  });

  it('fails terminally when the session cannot be created', async () => {
    const fake = await start({ env: { FAKE_ACP_FAIL_NEW: '1' } });

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(terminalError(fake)!.payload.text).toContain(
      'Authentication required',
    );
  });
});

describe('CursorAcpHarness startup', () => {
  it('fails fast without spawning when CURSOR_API_KEY is empty', async () => {
    await expect(
      startFakeCursorHarness({ env: { CURSOR_API_KEY: '  ' } }),
    ).rejects.toThrow(/CURSOR_API_KEY/);
  });

  it('loads a known session instead of creating one, ignoring replayed history', async () => {
    const fake = await start({ start: { initialSessionId: 'old-session' } });

    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'again' },
    });
    await waitFor(() => fake.timeline.includes('turn_completed'));

    const methods = fake.agentLog().map((m) => m.method);
    expect(methods).toContain('session/load');
    expect(methods).not.toContain('session/new');
    expect(
      fake.agentLog().find((m) => m.method === 'session/prompt')!.params
        .sessionId,
    ).toBe('old-session');
    expect(JSON.stringify(fake.persisted)).not.toContain('replayed');
  });

  it('adopts the session from ResumeTask and announces it', async () => {
    const fake = await start();

    fake.harness.sendCommand({
      commandName: TaskCommandName.ResumeTask,
      data: 'resumed-1',
    });
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'next' },
    });
    await idle(fake);

    expect(fake.timeline[0]).toBe('task:taskStarted');
    expect(
      fake.agentLog().find((m) => m.method === 'session/load')!.params
        .sessionId,
    ).toBe('resumed-1');
  });
});

describe('CursorAcpHarness queueing', () => {
  it('queues follow-ups sent during a turn and delivers them FIFO after end_turn', async () => {
    const fake = await start({ env: { FAKE_ACP_PROMPT_DELAY_MS: '200' } });

    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    for (const text of ['second', 'third']) {
      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text },
      });
    }
    expect(fake.harness.getQueuedMessages!().map((m) => m.text)).toEqual([
      'second',
      'third',
    ]);
    await idle(fake, 3);

    expect(prompts(fake)).toEqual(['first', 'second', 'third']);
    const firstDone = fake.timeline.indexOf('task:taskCompleted');
    const secondPrompt = fake.timeline.lastIndexOf(
      'persisted:roomote_runtime.user_prompt',
      fake.timeline.length,
    );
    expect(secondPrompt).toBeGreaterThan(firstDone);
    expect(fake.harness.getQueuedMessages!()).toEqual([]);
  });

  it('edits the queue: delete, prioritize, reorder, restore', async () => {
    const fake = await start();
    const send = (text: string) =>
      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text, queueOnly: true },
      });
    ['a', 'b', 'c', 'd'].forEach(send);
    const ids = () =>
      fake.harness.getQueuedMessageSnapshots!().map((m) => m.id);
    const texts = () =>
      fake.harness.getQueuedMessageSnapshots!().map((m) => m.text);
    const [a, b, c, d] = ids()!;

    fake.harness.sendCommand({
      commandName: TaskCommandName.DeleteQueuedMessage,
      data: { id: b! },
    });
    fake.harness.sendCommand({
      commandName: TaskCommandName.PrioritizeQueuedMessage,
      data: { id: c! },
    });
    fake.harness.sendCommand({
      commandName: TaskCommandName.ReorderQueuedMessage,
      data: { id: a!, targetId: d!, position: 'after' },
    });
    await waitFor(() => texts()!.join() === 'c,d,a');

    const snapshot = fake.harness.getQueuedMessageSnapshots!();
    fake.harness.sendCommand({ commandName: TaskCommandName.CloseTask });
    await waitFor(() => texts()!.length === 0);
    fake.harness.sendCommand({
      commandName: TaskCommandName.RestoreQueuedMessages,
      data: { queuedMessages: snapshot },
    });
    await waitFor(() => texts()!.join() === 'c,d,a');
  });

  it('drops a queued prompt the worker refuses and delivers the rest', async () => {
    const gate = vi
      .fn()
      .mockResolvedValueOnce({ shouldReconnect: false, shouldSkipPrompt: true })
      .mockResolvedValue(undefined);
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '150' },
      start: { beforeQueuedPrompt: gate },
    });

    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    ['skipped', 'kept'].forEach((text) =>
      fake.harness.sendCommand({
        commandName: TaskCommandName.SendMessage,
        data: { text },
      }),
    );
    await idle(fake, 2);

    expect(prompts(fake)).toEqual(['first', 'kept']);
  });

  it('asks for a restart and keeps the prompt when the worker requires a reconnect', async () => {
    const restart = vi.fn();
    const fake = await start({
      env: { FAKE_ACP_PROMPT_DELAY_MS: '100' },
      start: {
        beforeQueuedPrompt: async () => ({
          shouldReconnect: true,
          reason: 'mcp changed',
        }),
      },
    });
    fake.harness.on('restartRequested', restart);

    fake.harness.sendCommand(startTask('first'));
    await waitFor(() => fake.live.length > 1);
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'held' },
    });
    await waitFor(() => restart.mock.calls.length > 0);

    expect(restart.mock.calls[0]![0].reason).toBe('mcp changed');
    expect(
      fake.harness.getQueuedMessageSnapshots!().map((m) => m.text),
    ).toEqual(['held']);
  });

  it('rejects AnswerUserInputRequest deliberately', async () => {
    const fake = await start();

    expect(
      fake.harness.sendCommand({
        commandName: TaskCommandName.AnswerUserInputRequest,
        data: { requestId: 'r', answers: {} },
      }),
    ).toBe(false);
  });
});

describe('CursorAcpHarness cancel', () => {
  it('sends session/cancel, keeps the partial reply and records the attributed marker', async () => {
    const fake = await start();
    fake.harness.sendCommand(startTask('long [hold]'));
    await waitFor(() =>
      fake.live.some((e) => e.eventType.endsWith('assistant_message_chunk')),
    );
    fake.harness.sendCommand({
      commandName: TaskCommandName.SendMessage,
      data: { text: 'queued but cancelled' },
    });

    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Pat', source: 'web' } },
    });
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(fake.agentLog().some((m) => m.method === 'session/cancel')).toBe(
      true,
    );
    const order = fake.timeline.filter(
      (l) =>
        l === 'persisted:roomote_runtime.assistant_message' ||
        l === 'persisted:roomote_runtime.task_cancelled' ||
        l === 'task:taskAborted',
    );
    expect(order.at(-3)).toBe('persisted:roomote_runtime.assistant_message');
    expect(order.at(-2)).toBe('persisted:roomote_runtime.task_cancelled');
    expect(order.at(-1)).toBe('task:taskAborted');
    expect(fake.timeline).not.toContain('task:taskCompleted');
    expect(fake.harness.getQueuedMessages!()).toEqual([]);
    expect(prompts(fake)).toEqual(['long [hold]']);
  });

  it('records no marker for an internal cancel and still settles', async () => {
    const fake = await start();
    fake.harness.sendCommand(startTask('long [hold]'));
    await waitFor(() => fake.live.length > 1);

    fake.harness.sendCommand({ commandName: TaskCommandName.CancelTask });
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(fake.timeline.join()).not.toContain('task_cancelled');
  });

  it('settles after the grace period when the agent never acknowledges', async () => {
    const fake = await start({
      env: { FAKE_ACP_MODE: 'stall', CURSOR_ACP_CANCEL_GRACE_MS: '50' },
    });
    fake.harness.sendCommand(startTask('x'));
    await waitFor(() => prompts(fake).length === 1);

    fake.harness.sendCommand({
      commandName: TaskCommandName.CancelTask,
      data: { cancelledBy: { name: 'Pat' } },
    });
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(fake.timeline.join()).toContain('task_cancelled');
  });
});

describe('CursorAcpHarness failures', () => {
  it('cancels and fails terminally when the agent stalls with no output', async () => {
    const fake = await start({
      env: { FAKE_ACP_MODE: 'stall', CURSOR_ACP_IDLE_TIMEOUT_MS: '150' },
    });

    fake.harness.sendCommand(startTask('x'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(terminalError(fake)!.payload.text).toContain('no output');
    await waitFor(() =>
      fake.agentLog().some((m) => m.method === 'session/cancel'),
    );
    expect(
      fake.taskEvents.some(
        (e) =>
          (e.payload[0] as { message?: { say?: string } })?.message?.say ===
          'terminal_provider_error',
      ),
    ).toBe(true);
  });

  it('surfaces a terminal error, then disconnects, when the agent exits mid-turn', async () => {
    const fake = await start();
    const disconnected = vi.fn(() => fake.timeline.push('disconnected'));
    fake.harness.on('disconnected', disconnected);

    fake.harness.sendCommand(startTask('x [exit]'));
    await waitFor(() => disconnected.mock.calls.length > 0);

    expect(terminalError(fake)!.payload.text).toContain('exited');
    expect(fake.timeline.indexOf('task:taskAborted')).toBeLessThan(
      fake.timeline.indexOf('disconnected'),
    );
    expect(fake.harness.isConnected).toBe(false);
    await waitFor(() => !isAlive(fake.subprocess.pid));
  });

  it('emits disconnected without a failure when an idle agent dies', async () => {
    const fake = await start();
    const disconnected = vi.fn();
    fake.harness.on('disconnected', disconnected);

    process.kill(fake.subprocess.pid!, 'SIGKILL');
    await waitFor(() => disconnected.mock.calls.length > 0);

    expect(fake.harness.isConnected).toBe(false);
    expect(fake.timeline).toEqual([]);
    expect(fake.harness.sendCommand(startTask('late'))).toBe(false);
  });

  it('kills the agent process on dispose', async () => {
    const fake = await start();
    const pid = fake.subprocess.pid;
    expect(isAlive(pid)).toBe(true);

    fake.harness.dispose();

    await waitFor(() => !isAlive(pid));
  });
});
