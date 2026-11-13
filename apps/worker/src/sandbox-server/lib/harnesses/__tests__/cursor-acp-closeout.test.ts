import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  startFakeCursorHarness,
  startTask,
  waitFor,
} from './cursor-acp-test-harness';

type Fake = Awaited<ReturnType<typeof startFakeCursorHarness>>;

const live: Fake[] = [];
afterEach(() => live.splice(0).forEach((fake) => fake.dispose()));

const stateFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-closeout-')),
  'reply-state.json',
);
const UNSATISFIED = {
  startedAtMs: Date.now(),
  currentTurnMessageTs: '111.222',
  currentTurnStartedAtMs: Date.now() - 1_000,
};
const SATISFIED = {
  ...UNSATISFIED,
  messageTs: '111.223',
  tool: 'send_chat_reply',
  replyPurpose: 'closeout',
  recordedAtMs: Date.now(),
  satisfiedTurnMessageTs: '111.222',
  terminalSatisfiedTurnMessageTs: '111.222',
  terminalSatisfiedAtMs: Date.now(),
};

async function chatTask(
  state: object | undefined,
  env: Record<string, string> = {},
) {
  if (state) fs.writeFileSync(stateFile, JSON.stringify(state));
  const fake = await startFakeCursorHarness({
    env: {
      ROOMOTE_SLACK_REPLY_SATISFACTION_STATE_FILE: stateFile,
      ROOMOTE_SLACK_CHANNEL: 'C123',
      FAKE_ACP_SATISFY_FILE: stateFile,
      ...env,
    },
  });
  live.push(fake);
  fake.harness.sendCommand(startTask('do the thing'));
  await waitFor(() => fake.timeline.includes('task:taskCompleted'));
  return fake;
}

const promptTexts = (fake: Fake) =>
  fake
    .agentLog()
    .filter((m) => m.method === 'session/prompt')
    .map((m) => m.params.prompt.map((b) => b.text).join('\n'));
const completions = (fake: Fake) =>
  fake.taskEvents.filter((e) => e.eventName === 'taskCompleted');

describe('chat closeout stop hook', () => {
  it('lets a turn with a posted reply end without a reminder', async () => {
    const fake = await chatTask(SATISFIED);

    expect(promptTexts(fake)).toHaveLength(1);
    expect(completions(fake)).toHaveLength(1);
    expect(JSON.stringify(completions(fake)[0]!.payload)).not.toContain(
      'missingChatCloseout',
    );
  });

  it('never reminds a task that is not chat-originated', async () => {
    const fake = await startFakeCursorHarness();
    live.push(fake);

    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(promptTexts(fake)).toHaveLength(1);
  });

  it('sends a hidden reminder, then completes once the reply is posted', async () => {
    fs.rmSync(stateFile, { force: true });
    const fake = await chatTask(UNSATISFIED, {
      FAKE_ACP_PROMPT_DELAY_MS: '5',
    });
    const texts = promptTexts(fake);

    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('Before finalizing, post a terminal');
    expect(completions(fake)).toHaveLength(1);
    const reminder = fake.persisted.find(
      (e) =>
        e.eventType === 'roomote_runtime.user_prompt' &&
        e.metadata?.source === 'cursor-stop-hook',
    );
    expect(reminder).toBeDefined();
    // The persisted flag is what keeps the reminder out of a later handoff.
    expect(reminder!.visibleInTranscript).toBe(false);
  });

  it('still enforces the closeout when the state file names another engine session as its parent', async () => {
    // Cursor has no child threads, so no session id of its own can be a
    // "non-parent" thread that the hook lets through.
    const fake = await chatTask(
      { ...UNSATISFIED, parentThreadId: 'ses_opencode_made_this' },
      { FAKE_ACP_PROMPT_DELAY_MS: '5' },
    );

    expect(promptTexts(fake)).toHaveLength(2);
    expect(promptTexts(fake)[1]).toContain(
      'Before finalizing, post a terminal',
    );
  });

  it('gives up after a bounded number of reminders and flags the missing closeout', async () => {
    const fake = await chatTask(UNSATISFIED, { FAKE_ACP_SATISFY_FILE: '' });

    expect(promptTexts(fake)).toHaveLength(4);
    expect(completions(fake)).toHaveLength(1);
    expect(completions(fake)[0]!.payload[3]).toMatchObject({
      missingChatCloseout: { reminderCount: 3 },
    });
  });

  it('asks a fast-agent child to report to its parent Session instead', async () => {
    const fake = await chatTask(UNSATISFIED, {
      ROOMOTE_FAST_AGENT_CHILD: 'true',
      FAKE_ACP_SATISFY_FILE: '',
    });

    expect(promptTexts(fake)[1]).toContain('report to the parent Session');
  });
});
