import type { TaskModelRole } from './model-provider-config';

/**
 * Cursor has no chat-completions API, so `cursor/<model>` ids cannot be run by
 * OpenCode. They are served by Cursor's own agent (`cursor-agent acp`), which
 * only the coding role can use. Every OpenCode-backed role must treat a
 * `cursor/` id as unrunnable.
 */
export const CURSOR_PROVIDER_ID = 'cursor' as const;

const CURSOR_MODEL_ID_PREFIX = `${CURSOR_PROVIDER_ID}/`;

export function isCursorTaskModelId(
  modelId: string | null | undefined,
): boolean {
  return modelId?.trim().startsWith(CURSOR_MODEL_ID_PREFIX) ?? false;
}

/** `cursor/composer-2.5` becomes the Cursor agent's own id, `composer-2.5`. */
export function toCursorAgentModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();

  return trimmed.startsWith(CURSOR_MODEL_ID_PREFIX)
    ? trimmed.slice(CURSOR_MODEL_ID_PREFIX.length)
    : trimmed;
}

/** Only the coding role can run Cursor models; OpenCode runs every other. */
export function isTaskModelAllowedForRole(
  role: TaskModelRole,
  modelId: string | null | undefined,
): boolean {
  return role === 'coding' || !isCursorTaskModelId(modelId);
}
