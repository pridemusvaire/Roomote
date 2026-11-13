import { describeAcpError } from './acp-error-detail';
import type { AcpStopReason } from './acp-types';
import { isCursorQuotaError } from './quota-classifier';

export interface TurnResult {
  kind: 'completed' | 'cancelled' | 'failed' | 'closed';
  /** Last non-empty assistant message text of the turn. */
  text: string;
  /** Human-readable reason for `failed`. */
  message?: string;
  /** A Cursor plan-limit failure: retrying cannot succeed. */
  quota?: boolean;
}

export type TurnOutcome = Omit<TurnResult, 'text'> & {
  stopReason?: AcpStopReason;
};

export function outcomeFromStopReason(stopReason: AcpStopReason): TurnOutcome {
  switch (stopReason) {
    case 'cancelled':
      return { kind: 'cancelled', stopReason };
    case 'refusal':
      return {
        kind: 'failed',
        stopReason,
        message: 'The Cursor agent refused to continue this request.',
      };
    default:
      return { kind: 'completed', stopReason };
  }
}

/** `silentForMs` is the real silence, which a running command can stretch. */
export function stalledOutcome(silentForMs: number): TurnOutcome {
  const waited =
    silentForMs >= 60_000
      ? `${Math.round(silentForMs / 60_000)} minutes`
      : `${Math.max(1, Math.round(silentForMs / 1000))} seconds`;

  return {
    kind: 'failed',
    message: `The Cursor agent produced no output for ${waited} and was stopped.`,
  };
}

/** What an error thrown while a turn ran means for it. */
export function outcomeFromError(
  error: unknown,
  connectionClosed: boolean,
): TurnOutcome {
  return connectionClosed ? { kind: 'closed' } : failedOutcome(error);
}

function failedOutcome(error: unknown): TurnOutcome {
  return {
    kind: 'failed',
    quota: isCursorQuotaError(error),
    message: `Cursor agent error: ${describeAcpError(error)}`,
  };
}
