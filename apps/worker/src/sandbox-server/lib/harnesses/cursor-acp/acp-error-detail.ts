import { AcpRpcError } from './acp-rpc-error';

const GENERIC_MESSAGE = /^internal error$/i;

/** The most readable string inside an error's data, at any depth. */
function findDetail(data: unknown, depth = 0): string | undefined {
  if (typeof data === 'string') {
    return data.trim() || undefined;
  }

  if (!data || typeof data !== 'object' || depth > 4) {
    return undefined;
  }

  const record = data as Record<string, unknown>;

  for (const key of ['details', 'detail', 'message', 'error', 'title']) {
    const found = findDetail(record[key], depth + 1);

    if (found) {
      return found;
    }
  }

  return undefined;
}

/**
 * A readable reason for a failed ACP request. The agent wraps every failure
 * as `Internal error` and puts the real reason in `data`, so the message alone
 * says nothing: lead with the detail when there is one.
 */
export function describeAcpError(error: unknown): string {
  if (!(error instanceof AcpRpcError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const detail = findDetail(error.data);

  if (!detail || detail === error.message) {
    return error.message;
  }

  return GENERIC_MESSAGE.test(error.message)
    ? detail
    : `${error.message}: ${detail}`;
}
