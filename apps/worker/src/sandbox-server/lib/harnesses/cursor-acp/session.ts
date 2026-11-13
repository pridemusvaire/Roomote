import type { AcpConnection } from './acp-connection';
import type { AcpSessionResult, CursorSessionOptions } from './acp-types';
import { OneShotFlag } from './one-shot-flag';
import { loadSession, sessionParams } from './session-load';
import { SessionModel } from './session-model';
import { SessionRequests } from './session-requests';

/** Owns the ACP session: create or lazily load it, then pin the model. */
export class CursorSession {
  private sessionId: string | undefined;
  private pendingLoad = false;
  /** Raised after a `session/new`: the agent has no context or instructions yet. */
  readonly created = new OneShotFlag();
  /** Raised after a `session/load` failed and a new session replaced it. */
  readonly loadFailed = new OneShotFlag();

  private readonly requests: SessionRequests;
  private readonly model: SessionModel;

  constructor(
    connection: AcpConnection,
    private readonly options: CursorSessionOptions,
  ) {
    this.requests = new SessionRequests(connection, options);
    this.model = new SessionModel(this.requests, options);
  }

  get id(): string | undefined {
    return this.sessionId;
  }

  /** Adopts a known session, loaded on first use. */
  resume(sessionId: string): void {
    this.sessionId = sessionId;
    this.pendingLoad = true;
    this.model.reset();
  }

  async ensure(): Promise<string> {
    if (this.sessionId && !this.pendingLoad) {
      return this.sessionId;
    }

    if (this.sessionId) {
      const loaded = await loadSession(
        this.requests,
        this.sessionId,
        this.options,
      );

      if (loaded) {
        this.adopt(loaded, this.sessionId);
        return this.sessionId;
      }

      this.loadFailed.raise();
    }

    const result = await this.requests.request<AcpSessionResult>(
      'session/new',
      sessionParams(this.options),
      this.options.requestTimeoutMs,
    );

    if (!result.sessionId) {
      throw new Error('Cursor agent returned no session id from session/new.');
    }

    this.adopt(result, result.sessionId);
    this.created.raise();
    return result.sessionId;
  }

  /** Ends a rate-limit retry that is waiting (a cancel, a close). */
  stopRetrying(): void {
    this.requests.stopRetrying();
  }

  /** Selects the requested model once per session; throws if unavailable. */
  async ensureModel(): Promise<void> {
    if (this.sessionId) {
      await this.model.ensure(this.sessionId);
    }
  }

  private adopt(result: AcpSessionResult, sessionId: string): void {
    this.sessionId = sessionId;
    this.pendingLoad = false;
    this.model.reset(result.models?.availableModels);
  }
}
