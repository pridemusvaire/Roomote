import type { AcpModelInfo, CursorLog } from './acp-types';
import { resolveCursorAgentModelId } from './model-selection';
import type { SessionRequests } from './session-requests';

/**
 * Pins a session to the requested model. Throws `CursorModelUnavailableError`
 * (listing what is available) when the account lacks it. When the session
 * reported no model list there is nothing to validate against, so the agent
 * keeps its current model.
 */
export async function pinModel(options: {
  requests: SessionRequests;
  sessionId: string;
  requested: string;
  available: AcpModelInfo[] | undefined;
  timeoutMs: number;
  log: CursorLog;
}): Promise<void> {
  const { requests, sessionId, requested, available, timeoutMs, log } = options;

  if (!available) {
    log.warn('Session listed no models; keeping the current model.');
    return;
  }

  const modelId = resolveCursorAgentModelId(requested, available);
  await requests.request(
    'session/set_model',
    { sessionId, modelId },
    timeoutMs,
  );
  log.info(`Cursor model set to ${modelId}`);
}
