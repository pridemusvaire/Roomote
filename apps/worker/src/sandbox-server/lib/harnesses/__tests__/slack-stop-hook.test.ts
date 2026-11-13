import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  recordChatReplySatisfaction,
  recordChatTurnStart,
  setChatParentThread,
} from '../../../../mcp/roomote-mcp-server/chat-reply-satisfaction';
import { SLACK_STOP_HOOK_SCRIPT } from '../../../../run-task/slack-stop-hook-script';
import { evaluateSlackStopHook } from '../slack-stop-hook';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-hook-'));
const scriptPath = path.join(dir, 'stop-hook.cjs');
const stateFile = path.join(dir, 'state.json');
const logger = { error: vi.fn() };

fs.writeFileSync(scriptPath, SLACK_STOP_HOOK_SCRIPT);

const run = (script: Parameters<typeof evaluateSlackStopHook>[0]['script']) =>
  evaluateSlackStopHook({
    sessionId: 'ses_1',
    commandEnv: { ROOMOTE_SLACK_REPLY_SATISFACTION_STATE_FILE: stateFile },
    script,
    logger,
    label: 'Test',
  });

describe('evaluateSlackStopHook', () => {
  it.each([
    ['unsatisfied', { currentTurnMessageTs: '1.2' }],
    ['no chat turn', { startedAtMs: 1 }],
  ])(
    'decides the same whether the script is a file or inline (%s)',
    (_name, state) => {
      fs.writeFileSync(stateFile, JSON.stringify(state));

      expect(run({ source: SLACK_STOP_HOOK_SCRIPT })).toEqual(
        run({ path: scriptPath }),
      );
    },
  );

  it('blocks with the hook reason when the current turn has no reply', () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ currentTurnMessageTs: '1.2' }),
    );

    expect(run({ path: scriptPath })).toEqual({
      blocked: true,
      reason: expect.stringContaining('Before finalizing, post a terminal'),
    });
  });

  it('blocks with the fallback reminder when the script cannot run', () => {
    expect(run({ path: path.join(dir, 'missing.cjs') })).toMatchObject({
      blocked: true,
      reason: expect.stringContaining('Before finalizing'),
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('the chat closeout after the main session changes', () => {
  const CURSOR = '3f2a9c1e-7b4d-4e8a-9f61-0c5d2a8b7e14';
  const OPENCODE = 'ses_opencode_took_over';
  const hook = (sessionId?: string) =>
    evaluateSlackStopHook({
      sessionId,
      commandEnv: { ROOMOTE_SLACK_REPLY_SATISFACTION_STATE_FILE: stateFile },
      script: { path: scriptPath },
      logger,
      label: 'Test',
    });
  const replyAs = (sessionId: string) =>
    recordChatReplySatisfaction({
      stateFilePath: stateFile,
      messageTs: '9.9',
      tool: 'send_chat_reply',
      replyPurpose: 'closeout',
      sessionId,
    });

  beforeEach(() => {
    fs.rmSync(stateFile, { force: true });
    recordChatTurnStart({
      stateFilePath: stateFile,
      turnMessageTs: '1.2',
      sessionId: CURSOR,
    });
  });

  it('lets a session that is not the recorded parent end freely, and drops its replies', () => {
    expect(hook(OPENCODE)).toEqual({ blocked: false });
    replyAs(OPENCODE);

    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).messageTs).toBe(
      undefined,
    );
  });

  it('enforces the closeout and counts replies once the new session is the parent', () => {
    setChatParentThread({ stateFilePath: stateFile, sessionId: OPENCODE });

    expect(hook(OPENCODE)).toMatchObject({ blocked: true });
    replyAs(OPENCODE);
    expect(hook(OPENCODE)).toEqual({ blocked: false });
  });

  it('judges a hook call that names no thread against the turn itself', () => {
    expect(hook()).toMatchObject({ blocked: true });
    replyAs(CURSOR);
    expect(hook()).toEqual({ blocked: false });
  });
});
