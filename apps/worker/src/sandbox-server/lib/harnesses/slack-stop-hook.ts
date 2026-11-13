import { spawnSync } from 'node:child_process';

import {
  BLOCKED_FALLBACK,
  parseStopHookOutput,
  type StopHookDecision,
} from './slack-stop-hook-decision';
import { buildSlackStopHookEnv } from './slack-stop-hook-env';

/**
 * The chat-closeout stop hook, shared by every harness that must not end a
 * chat-originated turn before a reply was posted. The hook script decides
 * from the reply-satisfaction state file; a harness runs it when a turn ends
 * and, when it blocks, submits the reason as a hidden follow-up prompt.
 */

export { FALLBACK_STOP_HOOK_REMINDER } from './slack-stop-hook-decision';
export type { StopHookDecision } from './slack-stop-hook-decision';

/** Reminders sent for one turn before it completes without a closeout. */
export const MAX_STOP_HOOK_REMINDERS = 3;

/** The hook script: a file the harness wrote, or its source run inline. */
type StopHookScript = { path: string } | { source: string };

/** Runs the stop hook for `sessionId`; a hook that cannot run blocks. */
export function evaluateSlackStopHook(options: {
  /**
   * The calling thread. The hook lets a thread other than the state file's
   * parent end freely (a child session's turns are not the chat's). A harness
   * with no child sessions passes none, so no turn can be mistaken for one.
   */
  sessionId?: string;
  commandEnv: Record<string, string> | undefined;
  script: StopHookScript;
  logger: { error: (message: string) => void };
  label: string;
}): StopHookDecision {
  const { script, logger, label } = options;
  const result = spawnSync(
    process.execPath,
    'path' in script ? [script.path] : ['-e', script.source],
    {
      encoding: 'utf8',
      input: JSON.stringify({ threadId: options.sessionId }),
      env: buildSlackStopHookEnv(options.commandEnv),
    },
  );

  if (result.error) {
    logger.error(
      `${label} Slack stop hook failed error=${result.error.message}`,
    );
    return BLOCKED_FALLBACK;
  }

  if (result.status !== 0) {
    logger.error(
      `${label} Slack stop hook exited status=${result.status} stderr=${result.stderr}`,
    );
    return BLOCKED_FALLBACK;
  }

  return parseStopHookOutput(result.stdout, logger, label);
}
