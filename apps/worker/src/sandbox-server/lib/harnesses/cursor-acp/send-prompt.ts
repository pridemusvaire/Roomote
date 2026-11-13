import type { AcpConnection } from './acp-connection';
import type { AcpStopReason } from './acp-types';
import type { OutstandingPrompt } from './outstanding-prompt';
import { withRateLimitRetry } from './prompt-retry';
import { outcomeFromStopReason, type TurnOutcome } from './turn-outcome';
import type { TurnRunnerOptions } from './turn-runner-options';

/**
 * Sent instead of the original prompt when a throttled attempt had already
 * done work: the session holds that work, and the original would repeat its
 * side effects (a command, a post, a push).
 */
export const CONTINUE_AFTER_RATE_LIMIT_PROMPT =
  'Your previous attempt was interrupted by a temporary rate limit. Continue where you left off. Do not repeat steps that already completed.';

/**
 * Sends `session/prompt` and maps the answer to an outcome, retrying a
 * transient rate limit. A retry resends the prompt only while the throttled
 * attempt produced nothing; after that it asks the agent to continue.
 * Every request sent is tracked, so a later prompt can tell the agent has
 * not let go of this one.
 */
export async function sendPrompt(options: {
  connection: AcpConnection;
  outstanding: OutstandingPrompt;
  sessionId: string;
  prompt: Array<Record<string, unknown>>;
  signal: AbortSignal;
  /** How much the agent has produced this turn; a rise means work ran. */
  activity: () => number;
  tuning: Pick<TurnRunnerOptions, 'rateLimitBackoffMs' | 'log'>;
}): Promise<TurnOutcome> {
  const { connection, outstanding, sessionId, tuning } = options;
  let attemptStartedAt = options.activity();
  let workRan = false;
  const response = await withRateLimitRetry({
    send: () => {
      workRan ||= options.activity() > attemptStartedAt;
      attemptStartedAt = options.activity();
      const prompt = workRan
        ? [{ type: 'text', text: CONTINUE_AFTER_RATE_LIMIT_PROMPT }]
        : options.prompt;
      const request = connection.request<{ stopReason: AcpStopReason }>(
        'session/prompt',
        { sessionId, prompt },
      );
      outstanding.track(request);
      return request;
    },
    backoffMs: tuning.rateLimitBackoffMs,
    signal: options.signal,
    onRetry: (attempt, delayMs) =>
      tuning.log.warn(
        `Cursor rate limit; retrying the prompt in ${delayMs}ms (attempt ${attempt})`,
      ),
  });

  return outcomeFromStopReason(response.stopReason);
}
