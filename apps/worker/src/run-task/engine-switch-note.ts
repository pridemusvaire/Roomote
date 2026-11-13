import { sdk } from '@roomote/sdk/client';
import {
  ACP_ENVELOPE_EVENT_TYPES,
  ROOMOTE_RUNTIME_TASK_MESSAGE_PROTOCOL,
} from '@roomote/types';

import type { HarnessEngine } from './harness-engine';

const ENGINE_LABELS: Record<HarnessEngine['kind'], string> = {
  'cursor-acp': 'Cursor',
  'opencode-server': 'OpenCode',
};

export const engineLabel = (kind: HarnessEngine['kind']): string =>
  ENGINE_LABELS[kind];

/** What the user sees in the transcript when the task changes engine. */
export function buildEngineSwitchNote(
  from: HarnessEngine['kind'],
  to: HarnessEngine['kind'],
): string {
  return `This task switched from ${engineLabel(from)} to ${engineLabel(to)}. The new agent starts a fresh session, so it works from a summary of the conversation and earlier tool context may be missing.`;
}

/** A visible, non-terminal note in the transcript, filed under the old session. */
export async function persistSwitchNote(input: {
  runId: number;
  taskId: string;
  from: HarnessEngine['kind'];
  to: HarnessEngine['kind'];
  previousSessionId: string;
}): Promise<void> {
  const text = buildEngineSwitchNote(input.from, input.to);
  // Without a session (one that was never created) the note is filed under none.
  const session = input.previousSessionId
    ? { sessionId: input.previousSessionId }
    : {};

  await sdk.taskRuns.recordMessageEnvelope({
    runId: input.runId,
    taskId: input.taskId,
    envelope: {
      ts: Date.now(),
      eventType: ACP_ENVELOPE_EVENT_TYPES.AssistantMessage,
      role: 'assistant',
      protocol: ROOMOTE_RUNTIME_TASK_MESSAGE_PROTOCOL,
      contentBlocks: [{ type: 'text', text }],
      metadata: session,
      payload: { ...session, text },
    },
  });
}
