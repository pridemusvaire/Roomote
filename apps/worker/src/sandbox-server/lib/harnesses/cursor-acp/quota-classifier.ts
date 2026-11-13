import { AcpRpcError } from './acp-rpc-error';

// Ground truth, extracted from the cursor-agent 2026.11.11 bundle: ACP returns
// a failed backend request as JSON-RPC -32603 "Internal error" whose `data` is
// JSON.parse(original error message) when that is JSON, else
// `{ details: <message> }`. Cursor's own error codes appear inside it. (An
// unauthenticated session/new is different: code -32000, `data.message`.)

/** The plan's allowance is spent (or the model needs a paid plan). */
const PLAN_LIMIT_CODES =
  /\b(?:FREE_USER_USAGE_LIMIT|PRO_USER_USAGE_LIMIT|USAGE_LIMIT_EXCEEDED|USAGE_PRICING_REQUIRED(?:_CHANGEABLE)?|PRO_USER_ONLY)\b/i;

/** Clear allowance wording, for an error that carries only text. */
const PLAN_LIMIT_WORDING =
  /usage limit|hit your (?:usage )?limit|out of (?:credits|usage|requests)|upgrade (?:your|to a)(?: paid)? plan|usage-based pricing|spend limit/i;

/** A throttle that clears on its own. */
const RATE_LIMIT_CODES =
  /\b(?:FREE_USER_RATE_LIMIT_EXCEEDED|PRO_USER_RATE_LIMIT_EXCEEDED|RATE_LIMITED(?:_CHANGEABLE)?|GENERIC_RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED)\b/i;
// Not a bare "try again": that wording also ends authentication and other
// errors a retry cannot fix.
const RATE_LIMIT_WORDING = /\b429\b|rate[- ]?limit|too many requests/i;

type CursorErrorClass = 'plan-limit' | 'rate-limit' | 'other';

/** The message plus the whole data payload, at any depth, as one string. */
function errorText(error: AcpRpcError): string {
  const data = error.data === undefined ? '' : JSON.stringify(error.data);

  return `${error.message} ${data}`;
}

/**
 * Classifies a JSON-RPC error from `session/prompt`, `session/new`,
 * `session/load` or `session/set_model`. Only an error response can be a
 * limit: an agent message, however it is worded, never is. A plan limit wins
 * over a rate limit when the error shows both.
 */
export function classifyCursorError(error: unknown): CursorErrorClass {
  if (!(error instanceof AcpRpcError)) {
    return 'other';
  }

  const text = errorText(error);

  if (PLAN_LIMIT_CODES.test(text) || PLAN_LIMIT_WORDING.test(text)) {
    return 'plan-limit';
  }

  return RATE_LIMIT_CODES.test(text) || RATE_LIMIT_WORDING.test(text)
    ? 'rate-limit'
    : 'other';
}

export function isCursorQuotaError(error: unknown): boolean {
  return classifyCursorError(error) === 'plan-limit';
}
