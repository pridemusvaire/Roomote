import { TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY } from '@roomote/types';

import { buildTerminalErrorEvent } from '../../terminal-error-event';
import type { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';

/**
 * Ends the task with a visible, unrecoverable error: a transcript message
 * flagged as a terminal provider error, the semantic `say` event the harness
 * manager persists, and the abort that settles the run.
 */
export function emitTerminalError(
  events: OpenCodeRuntimeEventEmitter,
  sessionId: string,
  text: string,
): void {
  const marker = {
    [TERMINAL_PROVIDER_ERROR_PAYLOAD_KEY]: { errorSummary: text },
  };

  events.assistantMessage({
    sessionId,
    text,
    metadata: marker,
    payload: marker,
  });
  events.emitTaskEvent(buildTerminalErrorEvent(sessionId, text));
  events.taskAborted(sessionId);
}
