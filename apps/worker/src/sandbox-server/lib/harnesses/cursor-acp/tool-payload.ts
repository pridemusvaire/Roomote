import { asRecord, asString } from '@roomote/types';

import type { AcpToolContent } from './acp-types';
import { mcpToolInput, resolveMcpInvocation } from './mcp-invocation';
import type { ToolState } from './tool-state';

export function toolCommand(state: ToolState): string | null {
  return asString(asRecord(state.rawInput)?.command) ?? null;
}

function diffText(block: AcpToolContent): string | null {
  const diff = block as Extract<AcpToolContent, { type: 'diff' }>;

  if (diff.type !== 'diff') {
    return null;
  }

  return [
    `Edited ${diff.path}`,
    ...(diff.oldText ? [`--- before\n${diff.oldText}`] : []),
    `+++ after\n${diff.newText}`,
  ].join('\n');
}

/** A structured result with no shell streams, such as an MCP `{ success }`. */
function structuredOutput(rawOutput: ToolState['rawOutput']): string | null {
  const { stdout, stderr, ...rest } = rawOutput ?? {};
  delete rest.exitCode;

  return stdout || stderr || Object.keys(rest).length === 0
    ? null
    : JSON.stringify(rest);
}

export function renderToolOutput(state: ToolState): string {
  const { stdout, stderr } = state.rawOutput ?? {};
  const structured = structuredOutput(state.rawOutput);
  const parts = [
    ...(stdout ? [stdout] : []),
    ...(stderr ? [`stderr:\n${stderr}`] : []),
    ...(structured ? [structured] : []),
    ...(state.content ?? []).flatMap((block) => diffText(block) ?? []),
  ];

  return parts.join('\n');
}

/**
 * Same identity fields the OpenCode harness writes (`isMcp`, `mcpServerName`,
 * `mcpToolName`, `serverName`, `flattenedServerNames`), so everything that
 * reads tool payloads treats a Cursor MCP call like any other MCP call.
 */
export function buildToolPayload(
  state: ToolState,
  sessionId: string,
  mcpServerNames: readonly string[] = [],
): Record<string, unknown> {
  const command = toolCommand(state);
  const mcp = resolveMcpInvocation(state, mcpServerNames);
  const isExecute = !mcp && state.kind === 'execute';

  return {
    sessionId,
    toolCallId: state.toolCallId,
    kind: mcp ? 'mcp' : state.kind,
    toolName: mcp?.mcpToolName ?? state.title,
    title: state.title,
    status: state.status,
    isExecute,
    isRead: !mcp && state.kind === 'read',
    isMcp: Boolean(mcp),
    mcpServerName: mcp?.mcpServerName ?? null,
    mcpToolName: mcp?.mcpToolName ?? null,
    ...(mcp ? { serverName: mcp.mcpServerName } : {}),
    ...(mcpServerNames.length > 0
      ? { flattenedServerNames: [...mcpServerNames] }
      : {}),
    command,
    ...(state.rawInput !== undefined
      ? { rawInput: mcp ? mcpToolInput(state.rawInput) : state.rawInput }
      : {}),
    ...(state.rawOutput?.exitCode !== undefined
      ? { exitCode: state.rawOutput.exitCode }
      : {}),
  };
}
