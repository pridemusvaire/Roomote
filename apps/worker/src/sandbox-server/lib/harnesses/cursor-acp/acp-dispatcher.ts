import type { PendingRequests } from './acp-pending-requests';
import {
  answerAgentRequest,
  type RequestHandler,
} from './acp-request-handlers';

type Json = Record<string, unknown>;

/** Parses inbound lines and routes each message to its registered handler. */
export class AcpDispatcher {
  private readonly notifications = new Map<string, (p: unknown) => void>();
  private readonly requests = new Map<string, RequestHandler>();
  private readonly activityListeners: Array<() => void> = [];

  constructor(
    private readonly pending: PendingRequests,
    private readonly write: (message: Json) => void,
  ) {}

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notifications.set(method, handler);
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requests.set(method, handler);
  }

  onActivity(listener: () => void): () => void {
    this.activityListeners.push(listener);

    return () => {
      const index = this.activityListeners.indexOf(listener);
      if (index >= 0) this.activityListeners.splice(index, 1);
    };
  }

  /** Non-JSON lines (agent banners, warnings) are ignored. */
  handleLine(line: string): void {
    let message: Json;

    try {
      message = JSON.parse(line) as Json;
    } catch {
      return;
    }

    if (typeof message !== 'object' || message === null) {
      return;
    }

    this.activityListeners.forEach((listener) => listener());
    const { method, id, params } = message;

    if (typeof method !== 'string') {
      this.pending.settle(message);
    } else if (id === undefined) {
      this.notifications.get(method)?.(params);
    } else {
      void answerAgentRequest(
        this.requests.get(method),
        id as number,
        method,
        params,
      ).then((response) => this.write(response));
    }
  }
}
