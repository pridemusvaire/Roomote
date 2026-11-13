import { AcpRpcError } from '../cursor-acp/acp-rpc-error';
import {
  classifyCursorError,
  isCursorQuotaError,
} from '../cursor-acp/quota-classifier';

// Wire shape verified in the cursor-agent 2026.11.11 bundle: ACP returns a
// failed backend request as JSON-RPC code -32603 "Internal error", with `data`
// set to JSON.parse(original error message) when that is JSON, else
// `{ details: <message> }`. Cursor's own error codes ride inside that data.
const internal = (data: unknown) =>
  new AcpRpcError(-32603, 'Internal error', data);
const details = (message: string) => internal({ details: message });

describe('classifyCursorError', () => {
  it.each([
    'FREE_USER_USAGE_LIMIT',
    'PRO_USER_USAGE_LIMIT',
    'USAGE_LIMIT_EXCEEDED',
    'USAGE_PRICING_REQUIRED',
    'USAGE_PRICING_REQUIRED_CHANGEABLE',
    'PRO_USER_ONLY',
  ])('calls the Cursor error code %s a plan limit', (code) => {
    expect(classifyCursorError(internal({ error: { code } }))).toBe(
      'plan-limit',
    );
  });

  it.each([
    'FREE_USER_RATE_LIMIT_EXCEEDED',
    'PRO_USER_RATE_LIMIT_EXCEEDED',
    'RATE_LIMITED',
    'RATE_LIMITED_CHANGEABLE',
    'GENERIC_RATE_LIMIT_EXCEEDED',
    'RESOURCE_EXHAUSTED',
    'resource_exhausted',
  ])('calls the Cursor error code %s a transient rate limit', (code) => {
    expect(classifyCursorError(internal({ code }))).toBe('rate-limit');
  });

  it('finds a code at any depth of the data', () => {
    expect(
      classifyCursorError(
        internal({ a: { b: [{ c: { code: 'PRO_USER_USAGE_LIMIT' } }] } }),
      ),
    ).toBe('plan-limit');
  });

  it.each([
    'You have reached your usage limit for this plan',
    'Youve hit your limit for this month',
    "You've hit your usage limit",
    "You're out of credits",
    'You are out of requests for this billing period',
    'Upgrade your plan to continue',
    'Please upgrade to a paid plan',
    'Enable usage-based pricing to keep going',
    'Your spend limit was reached',
  ])('calls the wording "%s" a plan limit', (message) => {
    expect(classifyCursorError(details(message))).toBe('plan-limit');
    expect(classifyCursorError(new AcpRpcError(-32603, message))).toBe(
      'plan-limit',
    );
  });

  it.each([
    'Rate limit exceeded, try again later',
    'Too many requests',
    'HTTP 429',
    'Rate limit reached',
  ])('calls the wording "%s" a transient rate limit', (message) => {
    expect(classifyCursorError(details(message))).toBe('rate-limit');
  });

  it('prefers a plan limit when plan and transient markers are both present', () => {
    expect(
      classifyCursorError(
        internal({ code: 'RATE_LIMITED', next: 'PRO_USER_USAGE_LIMIT' }),
      ),
    ).toBe('plan-limit');
    expect(
      classifyCursorError(details('Usage limit reached. Try again later.')),
    ).toBe('plan-limit');
  });

  it.each([
    'Context limit reached',
    'Token limit reached for this request',
    'Invalid model value',
    'Authentication required',
    'Authentication failed, please try again',
    'Please try again in a moment',
    'Boom',
  ])('leaves "%s" alone', (message) => {
    expect(classifyCursorError(details(message))).toBe('other');
    expect(classifyCursorError(new AcpRpcError(-32603, message))).toBe('other');
  });

  it('only ever classifies a JSON-RPC error', () => {
    expect(classifyCursorError(new Error('Usage limit reached'))).toBe('other');
    expect(classifyCursorError('Usage limit reached')).toBe('other');
    expect(classifyCursorError(undefined)).toBe('other');
  });
});

describe('isCursorQuotaError', () => {
  it('is true for a plan limit only', () => {
    expect(isCursorQuotaError(details('You hit your usage limit'))).toBe(true);
    expect(isCursorQuotaError(details('Rate limit exceeded'))).toBe(false);
  });
});
