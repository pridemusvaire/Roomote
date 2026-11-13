import {
  asRecord,
  asString,
  extractAcpMcpInvocation,
  type AcpMcpInvocation,
} from '@roomote/types';

import type { ToolState } from './tool-state';

// VERIFIED against cursor-agent 2026.11.11 on 2026-11-12 (a stdio MCP server
// named "roomote"). An MCP call starts as an anonymous stub (title `MCP: tool`,
// kind `other`, empty rawInput); a later `tool_call_update` carries the
// identity as `rawInput.providerIdentifier` and `rawInput.toolName`, with the
// tool arguments under `rawInput.args`, and the title `<server>: <tool>`. No
// permission request is made. The title is the fallback for agent versions
// that omit the structured fields. Only configured server names match, so a
// native tool whose title merely contains a separator is never an MCP call.
const SEPARATORS = [':', '-', '/', '_', ' '];

type McpState = Pick<ToolState, 'kind' | 'title' | 'rawInput'>;

function fromRawInput(
  rawInput: unknown,
  serverNames: readonly string[],
): AcpMcpInvocation | null {
  const input = asRecord(rawInput);
  const server = asString(input?.providerIdentifier);
  const tool = asString(input?.toolName);

  return server && tool && serverNames.includes(server)
    ? { mcpServerName: server, mcpToolName: tool }
    : null;
}

function matchServerPrefix(
  title: string,
  serverNames: readonly string[],
): AcpMcpInvocation | null {
  const byLength = [...serverNames].sort((a, b) => b.length - a.length);

  for (const server of byLength) {
    for (const separator of SEPARATORS) {
      const prefix = `${server}${separator}`;
      const tool = title.slice(prefix.length).trim();

      if (title.startsWith(prefix) && tool && !/\s/.test(tool)) {
        return { mcpServerName: server, mcpToolName: tool };
      }
    }
  }

  return null;
}

/**
 * The MCP server and tool behind an ACP tool call, or null for native tools
 * and for the anonymous stub a call starts as. Resolved again on every update,
 * so the call is recognised as soon as one carries its identity.
 */
export function resolveMcpInvocation(
  state: McpState,
  serverNames: readonly string[],
): AcpMcpInvocation | null {
  if (serverNames.length === 0) {
    return null;
  }

  const parsed = extractAcpMcpInvocation(
    { kind: state.kind, title: state.title, rawInput: state.rawInput },
    {
      flattenedServerNames: serverNames,
      includeLegacyFlattenedServerNames: false,
    },
  );
  const isConfigured =
    parsed?.mcpServerName && serverNames.includes(parsed.mcpServerName);

  return (
    fromRawInput(state.rawInput, serverNames) ??
    (isConfigured ? parsed : null) ??
    matchServerPrefix(state.title, serverNames)
  );
}

/** What the tool was called with: the `args` of a structured MCP rawInput. */
export function mcpToolInput(rawInput: unknown): unknown {
  const input = asRecord(rawInput);

  return input && asString(input.providerIdentifier) && 'args' in input
    ? input.args
    : rawInput;
}
