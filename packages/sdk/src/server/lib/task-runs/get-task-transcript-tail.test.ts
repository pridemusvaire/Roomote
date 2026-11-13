import {
  db,
  eq,
  taskFactory,
  taskMessages,
  taskRuns,
  tasks,
} from '@roomote/db/server';
import {
  ACP_ENVELOPE_EVENT_TYPES,
  TaskPayloadKind,
  TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY,
  withTranscriptVisibility,
} from '@roomote/types';

import { getRunTranscriptTail } from './get-task-transcript-tail';
import { toTranscriptTurns } from './transcript-turns';
import { recordTaskMessageEnvelope } from './record-task-message-envelope';

const row = (
  eventType: string,
  text: string,
  metadata: Record<string, unknown> | null = null,
  payload: Record<string, unknown> = { text },
) => ({
  eventType,
  contentBlocks: [{ type: 'text' as const, text }],
  metadata,
  payload,
});
type EventType =
  (typeof ACP_ENVELOPE_EVENT_TYPES)[keyof typeof ACP_ENVELOPE_EVENT_TYPES];
const user = ACP_ENVELOPE_EVENT_TYPES.UserPrompt;
const assistant = ACP_ENVELOPE_EVENT_TYPES.AssistantMessage;

describe('toTranscriptTurns', () => {
  it('merges consecutive assistant segments into one turn before limiting', () => {
    const newestFirst = [
      row(assistant, 'third'),
      row(assistant, 'second'),
      row(assistant, 'first'),
      row(user, 'ship it'),
    ];

    expect(toTranscriptTurns(newestFirst, 2)).toEqual([
      { role: 'user', text: 'ship it' },
      { role: 'assistant', text: 'first\n\nsecond\n\nthird' },
    ]);
  });

  it('bounds one turn however long the run was', () => {
    const [turn] = toTranscriptTurns([row(assistant, 'y'.repeat(20_000))], 5);

    expect(turn!.text.length).toBeLessThanOrEqual(8_000);
  });

  it('keeps the latest text of a long merged assistant turn, and marks the cut', () => {
    const newestFirst = [
      row(assistant, 'the final answer'),
      row(assistant, 'y'.repeat(20_000)),
      row(assistant, 'the first step'),
    ];
    const [turn] = toTranscriptTurns(newestFirst, 5);

    expect(turn!.text.length).toBeLessThanOrEqual(8_000);
    expect(turn!.text.startsWith('…')).toBe(true);
    expect(turn!.text.endsWith('the final answer')).toBe(true);
    expect(turn!.text).not.toContain('the first step');
  });

  it('keeps the start of a long user prompt', () => {
    const [turn] = toTranscriptTurns(
      [row(user, `start of the ask ${'q'.repeat(20_000)}`)],
      5,
    );

    expect(turn!.text.startsWith('start of the ask')).toBe(true);
    expect(turn!.text.endsWith('…')).toBe(true);
  });

  it('returns the newest turns oldest first and drops hidden and error rows', () => {
    const hidden = withTranscriptVisibility(null, false);
    const newestFirst = [
      row(assistant, 'done'),
      row(assistant, 'Cursor plan limit hit', null, {
        [TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY]: { errorSummary: 'limit' },
      }),
      row(user, 'Continue. The previous model request failed', hidden),
      row(user, 'a reminder from a source nobody listed', hidden),
      row(user, 'please fix the bug'),
      row(assistant, '   '),
      row(assistant, 'older answer'),
    ];

    expect(toTranscriptTurns(newestFirst, 10)).toEqual([
      { role: 'assistant', text: 'older answer' },
      { role: 'user', text: 'please fix the bug' },
      { role: 'assistant', text: 'done' },
    ]);
    expect(toTranscriptTurns(newestFirst, 1)).toEqual([
      { role: 'assistant', text: 'done' },
    ]);
  });
});

async function seedTask(
  title: string,
  messages: Array<[number, EventType, string, boolean?]>,
) {
  const task = await taskFactory.create({ title });
  const [run] = await db
    .insert(taskRuns)
    .values({
      taskId: task.id,
      payloadKind: TaskPayloadKind.GithubPrReviewSync,
      payload: { repo: 'owner/repo' },
    })
    .returning();

  for (const [ts, eventType, text, visible] of messages) {
    await recordTaskMessageEnvelope({
      taskId: task.id,
      runId: run!.id,
      envelope: {
        ts,
        eventType,
        role: eventType === user ? 'user' : 'assistant',
        protocol: 'roomote_runtime',
        contentBlocks: [{ type: 'text', text }],
        metadata: null,
        payload: { text },
        ...(visible === undefined ? {} : { visibleInTranscript: visible }),
      },
    });
  }

  return { taskId: task.id, runId: run!.id };
}

async function cleanup(taskIds: string[]) {
  for (const id of taskIds) {
    await db.delete(taskMessages).where(eq(taskMessages.taskId, id));
    await db.delete(taskRuns).where(eq(taskRuns.taskId, id));
    await db.delete(tasks).where(eq(tasks.id, id));
  }
}

describe('getRunTranscriptTail', () => {
  it('reads only the persisted, visible conversation of the run task', async () => {
    const mine = await seedTask('Mine', [
      [1, user, 'build the thing'],
      [2, assistant, 'on it'],
      [3, ACP_ENVELOPE_EVENT_TYPES.ToolCall, 'ls'],
      [4, user, 'hidden reminder from any source', false],
    ]);
    const other = await seedTask('Other', [[1, user, 'other secret prompt']]);

    try {
      expect(await getRunTranscriptTail({ runId: mine.runId })).toEqual([
        { role: 'user', text: 'build the thing' },
        { role: 'assistant', text: 'on it' },
      ]);
      expect(await getRunTranscriptTail({ runId: other.runId })).toEqual([
        { role: 'user', text: 'other secret prompt' },
      ]);
    } finally {
      await cleanup([mine.taskId, other.taskId]);
    }
  });

  it('keeps the latest user prompt when more than 20 assistant segments follow it', async () => {
    const segments = Array.from(
      { length: 250 },
      (_, i): [number, EventType, string] => [10 + i, assistant, `step ${i}`],
    );
    const seeded = await seedTask('Long turn', [
      [1, user, 'old ask'],
      [2, assistant, 'old answer'],
      [3, user, 'refactor the parser'],
      [4, user, 'hidden reminder', false],
      ...segments,
    ]);

    try {
      const turns = await getRunTranscriptTail({ runId: seeded.runId });

      expect(turns[0]).toEqual({ role: 'user', text: 'refactor the parser' });
      expect(turns).toHaveLength(2);
      expect(turns[1]!.role).toBe('assistant');
      expect(turns[1]!.text).toContain('step 249');
      expect(turns[1]!.text.length).toBeLessThanOrEqual(8_000);
      expect(
        await getRunTranscriptTail({ runId: seeded.runId, limit: 1 }),
      ).toEqual([{ role: 'user', text: 'refactor the parser' }]);
    } finally {
      await cleanup([seeded.taskId]);
    }
  });

  it('returns nothing for an unknown run', async () => {
    expect(await getRunTranscriptTail({ runId: 2_000_000_000 })).toEqual([]);
  });
});
