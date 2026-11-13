import {
  and,
  db,
  desc,
  eq,
  inArray,
  taskMessages,
  taskRuns,
} from '@roomote/db/server';
import { ACP_ENVELOPE_EVENT_TYPES } from '@roomote/types';

import { toTranscriptTurns, type TranscriptTurn } from './transcript-turns';

/** Message rows read per query; a normal turn is many assistant segments. */
const SCAN_ROWS = 200;
/** Hidden prompts (reminders) may sit between the user and the latest one. */
const USER_PROMPT_SCAN_ROWS = 25;

const rowColumns = {
  eventType: taskMessages.eventType,
  contentBlocks: taskMessages.contentBlocks,
  metadata: taskMessages.metadata,
  payload: taskMessages.payload,
};

type EventType = typeof taskMessages.$inferSelect.eventType;

function recentMessages(taskId: string, eventTypes: EventType[], rows: number) {
  return db
    .select(rowColumns)
    .from(taskMessages)
    .where(
      and(
        eq(taskMessages.taskId, taskId),
        inArray(taskMessages.eventType, eventTypes),
      ),
    )
    .orderBy(desc(taskMessages.ts))
    .limit(rows);
}

/**
 * The latest conversation of the task a run belongs to, read from what was
 * persisted, so a new agent session (after an engine switch) can be told
 * where the work stands. The task is derived from the run here, never taken
 * from the caller, so one run cannot read another task's transcript.
 *
 * The latest visible user prompt is always included, however many assistant
 * messages followed it: a handoff without the request is useless.
 */
export async function getRunTranscriptTail(input: {
  runId: number;
  limit?: number;
}): Promise<TranscriptTurn[]> {
  const run = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, input.runId),
    columns: { taskId: true },
  });

  if (!run?.taskId) {
    return [];
  }

  const limit = input.limit ?? 20;
  const turns = toTranscriptTurns(
    await recentMessages(
      run.taskId,
      [
        ACP_ENVELOPE_EVENT_TYPES.UserPrompt,
        ACP_ENVELOPE_EVENT_TYPES.AssistantMessage,
      ],
      SCAN_ROWS,
    ),
    limit,
  );

  if (turns.some((turn) => turn.role === 'user')) {
    return turns;
  }

  // The prompt is older than the scanned rows: only assistant turns follow it.
  const [latestUser] = toTranscriptTurns(
    await recentMessages(
      run.taskId,
      [ACP_ENVELOPE_EVENT_TYPES.UserPrompt],
      USER_PROMPT_SCAN_ROWS,
    ),
    1,
  );

  if (!latestUser) {
    return turns;
  }

  return [latestUser, ...turns.slice(Math.max(0, turns.length - (limit - 1)))];
}
