import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_METHOD_NOT_FOUND,
} from './acp-rpc-error';

export type RequestHandler = (params: unknown) => Promise<unknown>;

/** Builds the JSON-RPC response to a request the agent sent to us. */
export async function answerAgentRequest(
  handler: RequestHandler | undefined,
  id: number,
  method: string,
  params: unknown,
): Promise<Record<string, unknown>> {
  if (!handler) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: JSON_RPC_METHOD_NOT_FOUND,
        message: `Method not found: ${method}`,
      },
    };
  }

  try {
    return { jsonrpc: '2.0', id, result: await handler(params) };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: JSON_RPC_INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
