import {
  DISABLED_MODEL_PROVIDER_ENV_VAR_NAMES,
  OPENCODE_AUTH_CONTENT_ENV_VAR_NAME,
  parseModelProviderEnvKeys,
} from '@roomote/types';

const MODEL_ENV_KEYS = 'R_MODEL_ENV_KEYS';

// run-task never hands these to a harness, whatever the server resolves.
const NEVER_DELIVERED = new Set<string>([
  ...DISABLED_MODEL_PROVIDER_ENV_VAR_NAMES,
  OPENCODE_AUTH_CONTENT_ENV_VAR_NAME,
]);

/**
 * Brings the model-provider entries of a task's runtime env up to date with
 * the env the server now resolves for it. Only the keys the old or the new
 * `R_MODEL_ENV_KEYS` list name are touched, so a task that switched to a
 * provider gets that provider's key and one that left a provider loses its
 * key, while everything run-task derived (HOME, task ids, gateway URL) stays.
 */
export function applyFreshModelProviderEnv(
  runtimeEnv: Record<string, string>,
  fresh: Record<string, string>,
): void {
  const keys = new Set([
    MODEL_ENV_KEYS,
    ...parseModelProviderEnvKeys(runtimeEnv[MODEL_ENV_KEYS]),
    ...parseModelProviderEnvKeys(fresh[MODEL_ENV_KEYS]),
  ]);

  for (const key of keys) {
    const value = fresh[key];

    if (value === undefined || NEVER_DELIVERED.has(key)) {
      delete runtimeEnv[key];
    } else {
      runtimeEnv[key] = value;
    }
  }
}
