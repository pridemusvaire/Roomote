import type { CursorLog } from './acp-types';

export interface TurnRunnerOptions {
  idleTimeoutMs: number;
  /** How long a new prompt waits for an abandoned one to settle. */
  settleGraceMs: number;
  rateLimitBackoffMs: readonly number[];
  /** The agent will not let go of its previous turn: restart its process. */
  onStuck: (sessionId: string) => void;
  log: CursorLog;
}

export const STUCK_MESSAGE =
  'The Cursor agent did not stop its previous turn in time and is being restarted. Send your message again.';
