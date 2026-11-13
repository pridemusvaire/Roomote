import { describeAcpError } from './acp-error-detail';
import type { AcpSessionResult, CursorSessionOptions } from './acp-types';
import { classifyCursorError } from './quota-classifier';
import type { SessionRequests } from './session-requests';

/** The `cwd` and MCP servers both `session/new` and `session/load` take. */
export function sessionParams(options: CursorSessionOptions) {
  return { cwd: options.workspacePath, mcpServers: options.mcpServers };
}

/**
 * Reloads a known ACP session; undefined (after a warning) when it cannot,
 * so the caller continues in a new session. A rate limit is retried first,
 * and one that outlasts the retries is thrown, not treated as a lost session:
 * the session still exists, and replacing it would drop its context. A load
 * that only times out is not rethrown as a wedged agent: a long session's
 * history is slow to replay, and a truly wedged agent fails the `session/new`
 * that follows instead.
 */
export async function loadSession(
  requests: SessionRequests,
  sessionId: string,
  options: CursorSessionOptions,
): Promise<AcpSessionResult | undefined> {
  try {
    return await requests.request<AcpSessionResult>(
      'session/load',
      { sessionId, ...sessionParams(options) },
      options.loadTimeoutMs,
    );
  } catch (error) {
    if (classifyCursorError(error) === 'rate-limit') {
      throw error;
    }

    options.log.warn(
      `session/load failed for ${sessionId}; starting a new session: ${describeAcpError(error)}`,
    );
    return undefined;
  }
}
