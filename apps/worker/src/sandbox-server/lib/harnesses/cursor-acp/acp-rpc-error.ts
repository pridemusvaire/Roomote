export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

/** The agent did not answer a request in time; it is presumed wedged. */
export class AcpTimeoutError extends Error {
  constructor(readonly method: string) {
    super(`ACP request ${method} timed out`);
    this.name = 'AcpTimeoutError';
  }
}

export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INTERNAL_ERROR = -32603;
