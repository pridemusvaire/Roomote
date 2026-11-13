import { TaskEventName, type TaskEvent } from '@roomote/types';

import { TERMINAL_PROVIDER_ERROR_SAY } from './harness';

const NO_SESSION_ID = 'harness-start-failed';

/** The task event that shows `text` as an unrecoverable provider error. */
export function buildTerminalErrorEvent(
  sessionId: string | undefined,
  text: string,
): TaskEvent {
  return {
    eventName: TaskEventName.Message,
    payload: [
      {
        taskId: sessionId ?? NO_SESSION_ID,
        action: 'created',
        message: {
          ts: Date.now(),
          type: 'say',
          say: TERMINAL_PROVIDER_ERROR_SAY,
          text,
        },
      },
    ],
  } as TaskEvent;
}
