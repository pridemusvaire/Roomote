import type { ToolState } from './tool-state';

// See mcp-invocation.ts: Cursor opens an MCP call as an anonymous `MCP: tool`
// stub and names it with a later update.
const ANONYMOUS_MCP_TITLE = /^MCP:/i;

/** True while an MCP call is still the nameless stub it opens as. */
export function isAnonymousMcpStub(
  state: ToolState,
  payload: Record<string, unknown>,
): boolean {
  return (
    ANONYMOUS_MCP_TITLE.test(state.title) &&
    payload.isMcp === false &&
    Array.isArray(payload.flattenedServerNames)
  );
}
