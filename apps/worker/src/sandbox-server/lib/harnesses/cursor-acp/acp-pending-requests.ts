import { AcpRpcError, AcpTimeoutError } from './acp-rpc-error';

type Json = Record<string, unknown>;

interface Pending {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/** Requests sent to the agent that are still waiting for a response. */
export class PendingRequests {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  add<T>(
    method: string,
    send: (id: number) => void,
    timeoutMs?: number,
  ): Promise<T> {
    const id = ++this.nextId;

    return new Promise<T>((resolve, reject) => {
      const entry: Pending = { resolve: resolve as Pending['resolve'], reject };

      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new AcpTimeoutError(method));
        }, timeoutMs);
      }

      this.pending.set(id, entry);
      send(id);
    });
  }

  settle(message: Json): void {
    const entry = this.pending.get(message.id as number);

    if (!entry) {
      return;
    }

    this.pending.delete(message.id as number);
    clearTimeout(entry.timer);
    const error = message.error as
      | { code: number; message: string; data?: unknown }
      | undefined;

    if (error) {
      entry.reject(new AcpRpcError(error.code, error.message, error.data));
    } else {
      entry.resolve(message.result as never);
    }
  }

  rejectAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }

    this.pending.clear();
  }
}
