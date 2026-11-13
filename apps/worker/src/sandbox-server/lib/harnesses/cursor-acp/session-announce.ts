import type { TurnContext } from './turn-context';

/**
 * Tells the manager about a session, which it needs before it accepts
 * anything emitted under it. Once per session unless `force`d.
 */
export function announceSession(
  ctx: TurnContext,
  sessionId: string,
  force = false,
): void {
  if (!force && ctx.state.announcedSessionId === sessionId) {
    return;
  }

  ctx.state.announcedSessionId = sessionId;
  ctx.events.taskStarted(sessionId);
}
