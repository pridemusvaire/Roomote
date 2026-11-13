import { randomUUID } from 'node:crypto';

const PLACEHOLDER_PREFIX = 'cursor-no-session-';

/**
 * A stand-in id for a task whose Cursor session could not be created. The
 * manager drops events that arrive under an id it was never told about, so the
 * failure needs one to be reported under. It is unique per failure and never
 * names a real session.
 */
export function newPlaceholderSessionId(): string {
  return `${PLACEHOLDER_PREFIX}${randomUUID()}`;
}

/** True for an id that must never be resumed: no agent session exists for it. */
export function isPlaceholderSessionId(sessionId: string): boolean {
  return sessionId.startsWith(PLACEHOLDER_PREFIX);
}
