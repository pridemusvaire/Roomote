import { buildInferenceProviderRecoveryPrompt } from '@roomote/types';

import {
  type HarnessEvents,
  type TaskCommand,
  TaskCommandName,
} from '../sandbox-server/lib/harness';

type FallbackRequest = HarnessEvents['modelFallbackRequested'][0];

/**
 * The hidden message that restarts work on the fallback model. A prompt that
 * never reached a model is replayed as it was; otherwise the agent is asked
 * to continue what it was doing.
 */
export function buildFallbackRecoveryMessage(request: FallbackRequest) {
  if (request.replayPrompt) {
    return {
      ...request.replayPrompt,
      source: request.replayPrompt.source ?? 'model-fallback-replay',
    };
  }

  return {
    text: request.agentType
      ? `The ${request.agentType} delegation failed because its provider was unavailable. Its model fallback is active now. Re-run that delegation and continue without repeating completed work.`
      : buildInferenceProviderRecoveryPrompt(),
    visibleInTranscript: false,
    source: 'model-fallback-recovery',
  };
}

/**
 * The recovery message as a command. The harness sends it once its
 * replacement is up, so a user stop that arrives first can take it back (see
 * `FallbackStop`).
 */
export function buildFallbackRecoveryCommand(
  request: FallbackRequest,
): TaskCommand {
  return {
    commandName: TaskCommandName.SendMessage,
    data: buildFallbackRecoveryMessage(request),
  };
}
