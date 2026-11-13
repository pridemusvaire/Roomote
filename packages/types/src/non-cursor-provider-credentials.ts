import {
  DEFAULT_MODEL_PROVIDER_CREDENTIAL_ENV_VAR_NAMES,
  parseModelProviderEnvKeys,
} from './model-provider-config';

const CURSOR_API_KEY = 'CURSOR_API_KEY';

/**
 * When this variable is set in a shell's environment, the worker's shell env
 * file (loaded through `BASH_ENV` and `.bashrc`) leaves the credentials named
 * by `getNonCursorModelProviderCredentialEnvVarNames` out of that shell.
 * The Cursor agent is started with it set, so the shells it runs never load
 * the keys the agent's own environment was stripped of.
 */
export const OMIT_MODEL_PROVIDER_KEYS_ENV_VAR =
  'ROOMOTE_OMIT_MODEL_PROVIDER_KEYS';

/**
 * Names of the model-provider credential variables of a task with runtime
 * `env`, every provider's but Cursor's own: the defaults plus those the
 * deployment declares in `R_MODEL_ENV_KEYS`. A task running on a Cursor model
 * must not hand its agent any of them: the agent runs its model on Cursor's
 * backend and uses none of them.
 */
export function getNonCursorModelProviderCredentialEnvVarNames(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const names = new Set([
    ...DEFAULT_MODEL_PROVIDER_CREDENTIAL_ENV_VAR_NAMES,
    ...parseModelProviderEnvKeys(env.R_MODEL_ENV_KEYS),
  ]);
  names.delete(CURSOR_API_KEY);

  return [...names];
}
