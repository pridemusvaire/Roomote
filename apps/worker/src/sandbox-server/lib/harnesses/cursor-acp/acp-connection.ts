import * as readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { AcpDispatcher } from './acp-dispatcher';
import { PendingRequests } from './acp-pending-requests';
import type { RequestHandler } from './acp-request-handlers';

export { AcpRpcError } from './acp-rpc-error';

type Json = Record<string, unknown>;

/**
 * Minimal JSON-RPC 2.0 client over a child's stdio (one JSON message per
 * line), enough for the Agent Client Protocol.
 */
export class AcpConnection {
  private closed = false;
  private readonly pending = new PendingRequests();
  private readonly dispatcher = new AcpDispatcher(this.pending, (message) =>
    this.write(message),
  );
  private readonly closeListeners: Array<() => void> = [];

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
  ) {
    readline
      .createInterface({ input: stdout, crlfDelay: Infinity })
      .on('line', (line) => this.dispatcher.handleLine(line))
      .on('close', () => this.close());
    stdin.on('error', () => this.close());
  }

  get isClosed(): boolean {
    return this.closed;
  }

  request<T>(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error(`ACP connection closed (${method})`));
    }

    return this.pending.add<T>(
      method,
      (id) => this.write({ jsonrpc: '2.0', id, method, params }),
      options?.timeoutMs,
    );
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.dispatcher.onNotification(method, handler);
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.dispatcher.onRequest(method, handler);
  }

  /** Fires for every inbound message; feeds idle watchdogs. */
  onActivity(listener: () => void): () => void {
    return this.dispatcher.onActivity(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.pending.rejectAll(new Error('ACP connection closed'));
    this.closeListeners.forEach((listener) => listener());
  }

  private write(message: Json): void {
    if (!this.closed) {
      this.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }
}
