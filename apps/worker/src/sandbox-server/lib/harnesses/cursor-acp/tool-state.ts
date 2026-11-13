import type { AcpSessionUpdate, AcpToolContent } from './acp-types';

export type ToolStatus = 'in_progress' | 'completed' | 'failed';

/** Accumulated state for one ACP tool call (updates carry optional fields). */
export interface ToolState {
  toolCallId: string;
  title: string;
  kind: string;
  status: ToolStatus;
  rawInput?: unknown;
  rawOutput?: AcpSessionUpdate['rawOutput'];
  content?: AcpToolContent[];
}

function normalizeToolStatus(status: string | undefined): ToolStatus {
  return status === 'completed' || status === 'failed' ? status : 'in_progress';
}

export function isTerminalToolStatus(status: ToolStatus): boolean {
  return status !== 'in_progress';
}

/** Updates carry only changed fields, so fold them into the known state. */
export function mergeToolState(
  id: string,
  update: AcpSessionUpdate,
  existing: ToolState | undefined,
): ToolState {
  return {
    toolCallId: id,
    title: update.title ?? existing?.title ?? 'Tool call',
    kind: update.kind ?? existing?.kind ?? 'other',
    status: update.status
      ? normalizeToolStatus(update.status)
      : (existing?.status ?? 'in_progress'),
    rawInput: update.rawInput ?? existing?.rawInput,
    rawOutput: update.rawOutput ?? existing?.rawOutput,
    content: Array.isArray(update.content) ? update.content : existing?.content,
  };
}
