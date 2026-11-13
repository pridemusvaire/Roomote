import {
  getNonCursorModelProviderCredentialEnvVarNames,
  OMIT_MODEL_PROVIDER_KEYS_ENV_VAR,
} from '@roomote/types';

/**
 * The environment `cursor-agent` runs with: the task's runtime env minus every
 * model-provider credential but Cursor's own (provider settings that are not
 * secret, such as a region, stay). The agent runs its model on Cursor's
 * backend and has shell access, so another provider's key in its environment
 * would be one `env` away from the model while nothing in the agent uses it.
 * What the coding agent legitimately needs (git and source-control tokens,
 * the Roomote tool env, `BASH_ENV`) stays.
 *
 * `BASH_ENV` and `.bashrc` load the worker's shell env file, which holds the
 * whole runtime env, so the agent's shells would put those keys straight back.
 * The flag set here tells that file to leave them out of the agent's shells.
 */
export function buildCursorAgentEnv(
  runtimeEnv: Record<string, string>,
): Record<string, string> {
  const providerKeys = new Set(
    getNonCursorModelProviderCredentialEnvVarNames(runtimeEnv),
  );

  return {
    ...Object.fromEntries(
      Object.entries(runtimeEnv).filter(([name]) => !providerKeys.has(name)),
    ),
    [OMIT_MODEL_PROVIDER_KEYS_ENV_VAR]: '1',
  };
}
