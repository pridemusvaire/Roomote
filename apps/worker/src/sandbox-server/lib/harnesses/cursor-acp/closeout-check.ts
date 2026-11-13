import { SLACK_STOP_HOOK_SCRIPT } from '../../../../run-task/slack-stop-hook-script';
import {
  evaluateSlackStopHook,
  type StopHookDecision,
} from '../slack-stop-hook';

import type { CursorLog } from './acp-types';

const STATE_FILE_ENV = 'ROOMOTE_SLACK_REPLY_SATISFACTION_STATE_FILE';

/** Asks whether the turn that just ended may end: has the chat been replied to? */
export type CloseoutCheck = () => StopHookDecision;

/**
 * The chat-closeout check for a task, or undefined when the task is not
 * chat-originated (no reply-satisfaction state file). It runs the same stop
 * hook script the OpenCode harness runs, so both decide identically from the
 * same state file and environment.
 */
export function createCloseoutCheck(
  runtimeEnv: Record<string, string>,
  log: CursorLog,
): CloseoutCheck | undefined {
  if (!runtimeEnv[STATE_FILE_ENV]) {
    return undefined;
  }

  // No thread id: Cursor has no child sessions, and its own session id can
  // differ from the one the state file recorded as the chat's parent (a
  // session restored or switched in from OpenCode), which the hook would
  // read as a child session and let end without a reply.
  return () =>
    evaluateSlackStopHook({
      commandEnv: runtimeEnv,
      script: { source: SLACK_STOP_HOOK_SCRIPT },
      logger: log,
      label: 'Cursor',
    });
}
