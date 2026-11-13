import type { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';

import { renderToolOutput } from './tool-payload';
import type { ToolState } from './tool-state';

export type ToolEmitter = Pick<
  OpenCodeRuntimeEventEmitter,
  'toolCall' | 'toolUpdate' | 'toolResult'
>;

/** Emits a tool's update, and its result once it reached a final status. */
export function emitToolProgress(
  emitter: ToolEmitter,
  progress: {
    sessionId: string;
    messageId: string;
    state: ToolState;
    payload: Record<string, unknown>;
  },
): void {
  const { state, payload, ...base } = progress;
  const output = renderToolOutput(state);
  const failed = state.status === 'failed';
  const toolCallId = state.toolCallId;

  emitter.toolUpdate({
    ...base,
    toolCallId,
    toolName: state.title,
    status: state.status,
    payload,
    ...(output ? { output } : {}),
    ...(failed ? { error: output || 'Tool call failed' } : {}),
  });

  if (state.status !== 'in_progress') {
    emitter.toolResult({
      ...base,
      toolCallId,
      status: state.status,
      output: failed && !output ? 'Tool call failed' : output,
      payload: { ...payload, output },
    });
  }
}
