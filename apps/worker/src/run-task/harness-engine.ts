import { isCursorTaskModelId, toCursorAgentModelPrefix } from '@roomote/types';

import { isPlaceholderSessionId } from '../sandbox-server/lib/harnesses/cursor-acp/placeholder-session';

/** Which agent runtime serves the coding model. */
export type HarnessEngine =
  | { kind: 'opencode-server' }
  | { kind: 'cursor-acp'; agentModel: string };

/**
 * Picks the runtime from the effective coding model. Called on every spawn,
 * not once, because a model fallback (Cursor to OpenCode and back) changes the
 * model between spawns of the same task.
 */
export function resolveHarnessEngine(
  codingModelId: string | undefined,
): HarnessEngine {
  return codingModelId && isCursorTaskModelId(codingModelId)
    ? {
        kind: 'cursor-acp',
        agentModel: toCursorAgentModelPrefix(codingModelId),
      }
    : { kind: 'opencode-server' };
}

// Cursor agent session ids are UUIDs; OpenCode ids are `ses_...`. A session id
// is persisted without the engine that made it (recording that would need a
// schema change), so the id's shape is the only marker a resumed run has.
const CURSOR_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SessionResume {
  /** The id the engine may resume; undefined starts a fresh session. */
  sessionId: string | undefined;
  /** The id belonged to the other engine: its context did not come along. */
  switchedFrom: HarnessEngine['kind'] | undefined;
}

/**
 * Decides what a spawn may resume. Handing one engine the other's id would
 * resume a session that does not exist, so it starts fresh instead and says
 * which engine the work came from, so the caller can carry the context over.
 * An id of a failed session creation never names a session and is dropped.
 * Without an id the engine cannot be read off it, so `previousEngine` (the one
 * that served the last spawn of this run, when there was one) says whether the
 * work came from the other engine: a Cursor run that never stored a session
 * still hands its conversation to OpenCode.
 */
export function resolveSessionResume(
  engine: HarnessEngine,
  sessionId: string | undefined,
  previousEngine?: HarnessEngine['kind'],
): SessionResume {
  if (!sessionId || isPlaceholderSessionId(sessionId)) {
    return {
      sessionId: undefined,
      switchedFrom:
        previousEngine && previousEngine !== engine.kind
          ? previousEngine
          : undefined,
    };
  }

  const isCursorSession = CURSOR_SESSION_ID.test(sessionId);

  if (isCursorSession === (engine.kind === 'cursor-acp')) {
    return { sessionId, switchedFrom: undefined };
  }

  return {
    sessionId: undefined,
    switchedFrom: isCursorSession ? 'cursor-acp' : 'opencode-server',
  };
}
