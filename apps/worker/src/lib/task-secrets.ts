import { sensitiveEnvEntries } from '@roomote/communication/redact-secrets';

import { runUnlessCredentialWriteBarrier } from './credential-write-barrier';
import {
  removeMaskSecretsFile,
  writeMaskSecretsFile,
} from './mask-secrets-file';
import {
  recordTaskSecretEntries,
  resetTaskSecretRegistryForTesting,
  taskSecretEntries,
} from './task-secret-registry';

export { onTaskSecretsAdded } from './task-secret-listeners';
export {
  recordTaskSecretEntries,
  taskSecretValues,
} from './task-secret-registry';

let fileInUse = false;

/** Takes in the secret-named variables of `env`. Call it for every env the agent can get. */
export function recordTaskSecrets(
  env: Readonly<Record<string, string | undefined>>,
): void {
  recordTaskSecretEntries(sensitiveEnvEntries(env));
}

/**
 * Rewrites the file the Roomote MCP server masks from, when the task uses it,
 * unless a snapshot holds the credential write barrier: the snapshot scrub
 * deletes the file, and nothing may bring it back until the restore releases
 * the barrier and refreshes it.
 */
export async function refreshMaskSecretsFile(): Promise<void> {
  if (!fileInUse) {
    return;
  }

  await runUnlessCredentialWriteBarrier(async () => {
    writeMaskSecretsFile(taskSecretEntries());
  });
}

/**
 * Takes in secrets that reached the task after it started: the listeners (the
 * live harness) are told, then the file the Roomote MCP server masks from is
 * rewritten. Secrets first, so none can be read before it is masked.
 */
export async function publishTaskSecrets(
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  recordTaskSecrets(env);
  await refreshMaskSecretsFile();
}

/**
 * Whether the running engine needs the file: Cursor does, OpenCode does not,
 * and leaves nothing on disk.
 */
export async function useMaskSecretsFile(enabled: boolean): Promise<void> {
  fileInUse = enabled;

  if (enabled) {
    await refreshMaskSecretsFile();
  } else {
    removeMaskSecretsFile();
  }
}

export function resetTaskSecretsForTesting(): void {
  resetTaskSecretRegistryForTesting();
  fileInUse = false;
}
