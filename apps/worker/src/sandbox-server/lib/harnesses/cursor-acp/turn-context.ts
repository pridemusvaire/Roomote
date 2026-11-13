import type { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';
import type { RuntimePromptQueue } from '../runtime-prompt-queue';

import type { CursorLog } from './acp-types';
import type {
  CursorAcpHarnessOptions,
  CursorFallbackConfig,
  ModelFallbackRequest,
} from './harness-options';
import type { CloseoutCheck } from './closeout-check';
import type { BeforeQueuedPrompt } from './queued-prompt-gate';
import type { CursorSession } from './session';
import type { TurnRunner } from './turn-runner';
import type { TurnState } from './turn-state';

export interface TurnContext {
  state: TurnState;
  session: CursorSession;
  runner: TurnRunner;
  events: OpenCodeRuntimeEventEmitter;
  prompts: RuntimePromptQueue;
  log: CursorLog;
  beforeQueuedPrompt: BeforeQueuedPrompt | undefined;
  cancelGraceMs: number;
  /** Sent once with the first prompt of each new Cursor session. */
  developerInstructions: string | undefined;
  /** Context for a session that replaced one that could not be loaded. */
  restoreContext: CursorAcpHarnessOptions['restoreContext'];
  /** Requested Cursor model name, for user-facing messages. */
  requestedModel: string | undefined;
  /** Set for chat-originated tasks: a turn may not end without a reply. */
  closeoutCheck: CloseoutCheck | undefined;
  fallback: CursorFallbackConfig | undefined;
  requestFallback: (request: ModelFallbackRequest) => void;
  isDisposed: () => boolean;
  requestRestart: (reason: string, sessionId: string | undefined) => void;
}
