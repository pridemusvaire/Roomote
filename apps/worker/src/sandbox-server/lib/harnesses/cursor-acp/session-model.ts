import type { AcpModelInfo, CursorSessionOptions } from './acp-types';
import { pinModel } from './model-pin';
import type { SessionRequests } from './session-requests';

/** Pins the requested model once per session, from the list it reported. */
export class SessionModel {
  private available: AcpModelInfo[] | undefined;
  private applied = false;

  constructor(
    private readonly requests: SessionRequests,
    private readonly options: CursorSessionOptions,
  ) {}

  /** A new or loaded session: its model list, and nothing pinned yet. */
  reset(available: AcpModelInfo[] | undefined = this.available): void {
    this.available = available;
    this.applied = false;
  }

  /** Throws if the requested model is unavailable. */
  async ensure(sessionId: string): Promise<void> {
    const { requestedModel, requestTimeoutMs, log } = this.options;

    if (!requestedModel || this.applied) {
      return;
    }

    await pinModel({
      requests: this.requests,
      sessionId,
      requested: requestedModel,
      available: this.available,
      timeoutMs: requestTimeoutMs,
      log,
    });
    this.applied = true;
  }
}
