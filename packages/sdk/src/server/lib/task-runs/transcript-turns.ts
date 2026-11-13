import {
  ACP_ENVELOPE_EVENT_TYPES,
  asRecord,
  extractAcpMessageText,
  getTerminalProviderErrorFromMessageData,
  isVisibleInTranscript,
  type TaskMessageContentBlock,
  type TaskMessageMetadata,
  clipText,
} from '@roomote/types';

/** Written out where used: the router's inferred type must name it. */
export type TranscriptTurn = { role: 'user' | 'assistant'; text: string };

interface TranscriptRow {
  eventType: string;
  contentBlocks: TaskMessageContentBlock[];
  metadata: unknown;
  payload: unknown;
}

/** Keeps one turn bounded, so a long run cannot bloat the response. */
const MAX_TURN_CHARS = 8_000;

function isTerminalError(row: TranscriptRow): boolean {
  return [row.payload, row.metadata].some(
    (data) => getTerminalProviderErrorFromMessageData(asRecord(data)) !== null,
  );
}

/**
 * Oldest first, one turn per exchange the user saw: hidden prompts (runtime
 * reminders, recovery requests) and terminal provider errors are not part of
 * the conversation. An agent writes a separate message for each stretch of
 * text between tool calls, so consecutive assistant messages are one turn;
 * the limit counts turns, not rows. A long turn keeps its latest text: for an
 * agent that is where its work ended up.
 */
export function toTranscriptTurns(
  newestFirst: TranscriptRow[],
  limit: number,
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];

  for (const row of [...newestFirst].reverse()) {
    const text = extractAcpMessageText(
      row.contentBlocks,
      asRecord(row.payload) ?? null,
    )?.trim();
    const metadata = asRecord(row.metadata) as TaskMessageMetadata | undefined;

    if (!text || !isVisibleInTranscript(metadata) || isTerminalError(row)) {
      continue;
    }

    const role =
      row.eventType === ACP_ENVELOPE_EVENT_TYPES.UserPrompt
        ? 'user'
        : 'assistant';
    const previous = turns.at(-1);

    if (role === 'assistant' && previous?.role === 'assistant') {
      previous.text = `${previous.text}\n\n${text}`;
    } else {
      turns.push({ role, text });
    }
  }

  return turns.slice(-limit).map((turn) => ({
    ...turn,
    text: clipText(
      turn.text,
      MAX_TURN_CHARS,
      turn.role === 'assistant' ? 'end' : 'start',
    ),
  }));
}
