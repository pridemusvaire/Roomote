import type { ReasoningEffort, TaskModelRole } from '@roomote/types';

import type { HarnessEvents } from '../../harness';
import type { HarnessLogger } from '../../../../logging';

import type { AcpConnection } from './acp-connection';
import type { AcpMcpServer } from './acp-types';
import type { CloseoutCheck } from './closeout-check';
import type { BeforeQueuedPrompt } from './queued-prompt-gate';
import type { SecretSet } from './secret-mask';

/** The coding fallback the worker may switch to when Cursor's plan runs out. */
export interface CursorFallbackConfig {
  role: TaskModelRole;
  /** Roomote id of the model running now, e.g. `cursor/composer-2.5`. */
  activeModelId: string;
  fallbackModel: string;
  fallbackReasoningEffort?: ReasoningEffort;
  /**
   * `role:model` of every fallback already requested. Owned by the worker, not
   * the harness, so it survives the respawn a fallback causes: a replacement
   * Cursor harness that hits the limit again ends the task instead of
   * requesting the same fallback forever.
   */
  attempts: Set<string>;
}

export type ModelFallbackRequest = HarnessEvents['modelFallbackRequested'][0];

export interface CursorAcpHarnessOptions {
  connection: AcpConnection;
  workspacePath: string;
  logger: HarnessLogger;
  mcpServers: AcpMcpServer[];
  initialSessionId?: string;
  /** Requested Cursor model name without the `cursor/` prefix. */
  requestedModel?: string;
  /** Roomote's standing instructions, sent with a new session's first prompt. */
  developerInstructionsContent?: string;
  idleTimeoutMs?: number;
  /** Bounds session setup requests (`session/new`, `load`, `set_model`). */
  requestTimeoutMs?: number;
  /**
   * Bounds `session/load` alone: replaying a long session's history takes far
   * longer than the other setup requests, and a timeout here falls back to a
   * fresh session instead of failing the task.
   */
  loadTimeoutMs?: number;
  /**
   * Builds the standing context a fresh session needs when the one it should
   * have continued could not be loaded, from the persisted conversation and
   * the prompt about to run (`hidden` when the transcript does not show it, so
   * it is an instruction and not the user's request). Best effort: a failure
   * only loses the context.
   */
  restoreContext?: (prompt: {
    text: string;
    hidden?: boolean;
  }) => Promise<string | undefined>;
  /**
   * Exact values the agent's output must never carry (the task's secret
   * variables); each is masked wherever a tool result or a reply shows it.
   * Shared with the agent's stderr log, and grown when a secret reaches the
   * task after the agent started.
   */
  secrets: SecretSet;
  /** Waits before each retry of a rate-limited prompt. */
  rateLimitBackoffMs?: readonly number[];
  /** How long a cancel waits for the agent to acknowledge before moving on. */
  cancelGraceMs?: number;
  fallback?: CursorFallbackConfig;
  /** Chat-originated tasks only: blocks ending a turn with no reply posted. */
  closeoutCheck?: CloseoutCheck;
  beforeQueuedPrompt?: BeforeQueuedPrompt;
  /** Releases the agent process; called once on dispose. */
  onDispose?: () => void;
}
