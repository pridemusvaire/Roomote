import { sdk } from '@roomote/sdk/client';

import { setChatParentThread } from '../mcp/roomote-mcp-server/chat-reply-satisfaction';
import { isPlaceholderSessionId } from '../sandbox-server/lib/harnesses/cursor-acp/placeholder-session';

interface StartedSession {
  taskRun: { id: number; result?: unknown };
  sessionId: string;
  stateFilePath: string | undefined;
  logger: { warn: (message: string) => void };
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Records the session the harness announced as the run's: the chat's parent
 * thread, the id a resume continues from, and `runtimeTaskId`. A placeholder
 * id (a Cursor session that could not be created, announced only so its
 * failure can be reported) names no session and is never recorded.
 */
export async function persistStartedSession(
  started: StartedSession,
): Promise<void> {
  const { taskRun, sessionId, stateFilePath, logger } = started;

  if (isPlaceholderSessionId(sessionId)) {
    return;
  }

  // The announced session is the task's main one, so it is the chat's parent
  // thread: after an engine switch or a session that could not be restored,
  // the stop hook must keep enforcing the closeout on it.
  try {
    setChatParentThread({ sessionId, stateFilePath });
  } catch (error) {
    logger.warn(
      `[runTask] Failed to record the chat parent thread ${sessionId}: ${describe(error)}`,
    );
  }

  try {
    await sdk.taskRuns.setHarnessSessionId({
      runId: taskRun.id,
      harnessSessionId: sessionId,
    });
  } catch (error) {
    logger.warn(
      `[runTask] Failed to persist harness session ID for task run ${taskRun.id}: ${describe(error)}`,
    );
  }

  const existing =
    taskRun.result &&
    typeof taskRun.result === 'object' &&
    !Array.isArray(taskRun.result)
      ? (taskRun.result as Record<string, unknown>)
      : {};

  // Keep runtimeTaskId synchronized with the actual started harness session
  // so SnapshotResume runs do not reuse stale IDs.
  if (existing.runtimeTaskId !== sessionId) {
    const next = { ...existing, runtimeTaskId: sessionId };
    await sdk.taskRuns.update({ id: taskRun.id, result: next });
    taskRun.result = next;
  }
}
