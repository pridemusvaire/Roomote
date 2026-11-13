import type { ReasoningEffort, TaskModelRole } from '@roomote/types';

import type { CursorFallbackConfig } from './harness-options';

/** All four options are needed to switch models; otherwise there is none. */
export function toFallbackConfig(options: {
  fallbackModel?: string;
  fallbackReasoningEffort?: ReasoningEffort;
  fallbackRole?: TaskModelRole;
  activeModelId?: string;
  fallbackAttempts?: Set<string>;
}): CursorFallbackConfig | undefined {
  const { fallbackModel, fallbackRole, activeModelId } = options;

  if (!fallbackModel || !fallbackRole || !activeModelId) {
    return undefined;
  }

  return {
    role: fallbackRole,
    activeModelId,
    fallbackModel,
    fallbackReasoningEffort: options.fallbackReasoningEffort,
    attempts: options.fallbackAttempts ?? new Set(),
  };
}
