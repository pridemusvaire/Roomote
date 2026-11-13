import { sdk } from '@roomote/sdk/client';

import type { HarnessLogger } from '../logging';

import {
  buildEngineHandoffInstructions,
  type ReplayPrompt,
} from './engine-handoff';
import { persistSwitchNote } from './engine-switch-note';
import type { HarnessEngine } from './harness-engine';

interface EngineSwitch {
  runId: number;
  taskId: string;
  from: HarnessEngine['kind'];
  to: HarnessEngine['kind'];
  /** The session the work was in, which the note is filed under. */
  previousSessionId: string;
  /** Skip the transcript note (it was already shown for this switch). */
  announce: boolean;
  /** A prompt being replayed that the previous engine never saw. */
  replayPrompt?: ReplayPrompt;
  logger: HarnessLogger;
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The task's conversation so far as standing instructions for a fresh agent
 * session, rebuilt from the persisted transcript. `replayPrompt` is the
 * prompt that session is about to run, when it is not persisted yet. A failure
 * to read the transcript is logged and yields nothing.
 */
export async function readHandoffInstructions(input: {
  runId: number;
  from: HarnessEngine['kind'];
  replayPrompt?: ReplayPrompt;
  logger: HarnessLogger;
}): Promise<string | undefined> {
  try {
    const turns = await sdk.taskRuns.getTranscriptTail({ runId: input.runId });

    return buildEngineHandoffInstructions(
      input.from,
      turns,
      input.replayPrompt,
    );
  } catch (error) {
    input.logger.warn(
      `[engineSwitch] Could not read the transcript for run ${input.runId}: ${reason(error)}`,
    );
    return undefined;
  }
}

/**
 * The agent engine changed (a model fallback or a per-task model switch moved
 * the coding model between Cursor and OpenCode), so the new engine starts a
 * fresh session that knows nothing of the task. Tells the user, and returns
 * the standing instructions that carry the conversation across, rebuilt from
 * the persisted transcript. A failure to read or write either is logged and
 * never stops the switch.
 */
export async function prepareEngineSwitch(
  input: EngineSwitch,
): Promise<string | undefined> {
  const [instructions] = await Promise.all([
    readHandoffInstructions({
      runId: input.runId,
      from: input.from,
      replayPrompt: input.replayPrompt,
      logger: input.logger,
    }),
    input.announce
      ? persistSwitchNote(input).catch((error: unknown) =>
          input.logger.warn(
            `[engineSwitch] Could not record the switch note for run ${input.runId}: ${reason(error)}`,
          ),
        )
      : undefined,
  ]);

  return instructions;
}
