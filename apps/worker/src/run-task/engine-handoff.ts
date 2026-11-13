import { clipText } from '@roomote/types';

import { engineLabel } from './engine-switch-note';
import type { HarnessEngine } from './harness-engine';

interface HandoffTurn {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_USER_PROMPT_CHARS = 8_000;
const MAX_HISTORY_TURN_CHARS = 600;

/** An assistant turn keeps its latest text, where its work ended up. */
function clipTurn(turn: HandoffTurn): string {
  return clipText(
    turn.text,
    MAX_HISTORY_TURN_CHARS,
    turn.role === 'assistant' ? 'end' : 'start',
  );
}

/** A prompt the next session is about to run that is not persisted yet. */
export interface ReplayPrompt {
  text: string;
  /**
   * Not shown in the transcript (a closeout reminder, a recovery nudge): an
   * instruction for the turn, never the user's request.
   */
  hidden?: boolean;
}

/**
 * Standing instructions for the fresh session after an engine switch: the
 * latest user request verbatim, then a short history, built from the
 * persisted transcript. A visible `replay` prompt never reached the old engine
 * and is not persisted yet: it is the current request, and every persisted
 * turn is history. A hidden one is not the user's words, so the last persisted
 * user turn stays the request and the hidden text is added as an instruction.
 * Returns undefined when there is nothing to carry.
 */
export function buildEngineHandoffInstructions(
  from: HarnessEngine['kind'],
  turns: readonly HandoffTurn[],
  replay?: ReplayPrompt,
): string | undefined {
  const replayText = replay?.text.trim();
  const lastUserIndex = turns.map((turn) => turn.role).lastIndexOf('user');
  const replayIsPersisted =
    replayText !== undefined &&
    turns[lastUserIndex]?.text.trim() === replayText;
  const replaysNewPrompt =
    replayText !== undefined && !replayIsPersisted && !replay?.hidden;
  const instruction =
    replay?.hidden && !replayIsPersisted ? replayText : undefined;

  if (turns.length === 0 || (lastUserIndex < 0 && !replaysNewPrompt)) {
    return undefined;
  }

  const current = replaysNewPrompt ? replayText : turns[lastUserIndex]!.text;
  const historyEnd = replaysNewPrompt ? turns.length : lastUserIndex;
  const history = turns
    .slice(0, historyEnd)
    .map(
      (turn) =>
        `- ${turn.role === 'user' ? 'User' : 'Assistant'}: ${clipTurn(turn)}`,
    );
  const after = replaysNewPrompt
    ? []
    : turns
        .slice(lastUserIndex + 1)
        .filter((turn) => turn.role === 'assistant')
        .map((turn) => `- Assistant: ${clipTurn(turn)}`);

  return [
    `# Task handoff`,
    `This task was running on ${engineLabel(from)} and continues in this new session. Tool calls and results from the earlier session are not available here; the conversation below is a summary. Do not repeat work or messages already completed.`,
    ...(history.length > 0 ? ['', '## Earlier conversation', ...history] : []),
    '',
    "## The user's latest request (verbatim)",
    clipText(current, MAX_USER_PROMPT_CHARS),
    ...(after.length > 0 ? ['', '## What you already replied', ...after] : []),
    ...(instruction
      ? [
          '',
          '## Instruction for this turn (not from the user)',
          clipText(instruction, MAX_USER_PROMPT_CHARS),
        ]
      : []),
  ].join('\n');
}
