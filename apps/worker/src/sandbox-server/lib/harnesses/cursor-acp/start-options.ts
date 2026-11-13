import type { ReasoningEffort, TaskModelRole } from '@roomote/types';

import type { HarnessLogger } from '../../../../logging';

import type { CursorAcpHarnessOptions } from './harness-options';
import type { BeforeQueuedPrompt } from './queued-prompt-gate';

export interface StartCursorAcpHarnessOptions {
  workspacePath: string;
  runtimeEnv: Record<string, string>;
  /**
   * Secret values to mask out of the agent's output. Defaults to the secret
   * variables of `runtimeEnv`; the worker passes a wider set that includes the
   * source-control tokens the agent's shells load but its spawn env omits.
   */
  secretValues?: readonly string[];
  cancelSignal: AbortSignal;
  logger: HarnessLogger;
  mcpServers: Record<string, unknown>;
  initialSessionId?: string;
  /** Cursor model name without the `cursor/` prefix, e.g. `composer-2.5`. */
  modelOverride?: string;
  /** Coding fallback model options, as create-harness passes to OpenCode. */
  fallbackModel?: string;
  fallbackReasoningEffort?: ReasoningEffort;
  fallbackRole?: TaskModelRole;
  activeModelId?: string;
  /** Fallbacks already requested; shared across respawns (see the config). */
  fallbackAttempts?: Set<string>;
  beforeQueuedPrompt?: BeforeQueuedPrompt;
  developerInstructionsContent?: string;
  /** Rebuilds the conversation for a session that replaced a lost one. */
  restoreContext?: CursorAcpHarnessOptions['restoreContext'];
  /** Overrides the `cursor-agent acp` command (tests point this at a fake). */
  agentCommand?: { command: string; args: string[] };
}
