const CURSOR_ME_URL = 'https://api.cursor.com/v1/me';
const CHECK_TIMEOUT_MS = 10_000;

/** What Cursor said about an API key. `unreachable` says nothing about it. */
type CursorKeyCheck = 'valid' | 'rejected' | 'unreachable';

/**
 * Asks Cursor who the key belongs to, the cheapest authenticated call there
 * is. Only a 401 or 403 says the key is bad; a timeout, a network failure or
 * any other status says nothing about it, so the caller must not block on it.
 * The key travels in the request header only: it is never logged or returned.
 */
export async function checkCursorApiKey(
  apiKey: string,
): Promise<CursorKeyCheck> {
  try {
    const response = await fetch(CURSOR_ME_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });

    if (response.ok) {
      return 'valid';
    }

    return response.status === 401 || response.status === 403
      ? 'rejected'
      : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
