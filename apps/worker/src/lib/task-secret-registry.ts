import { GIT_CREDENTIAL_NAME } from './git-credential-name';
import type { MaskSecret } from './mask-secrets-file';
import {
  clearTaskSecretListenersForTesting,
  notifyTaskSecretsAdded,
} from './task-secret-listeners';

/**
 * Every secret value the task's agent has been able to see, with the variable
 * it came from. Only ever added to: a value that was rotated out stays masked,
 * because the agent may still hold it. In memory only; the mask file is its
 * one copy on disk.
 */
const nameByValue = new Map<string, string>();

/** Every value to mask. */
export function taskSecretValues(): string[] {
  return [...nameByValue.keys()];
}

/** Every value with the variable it came from. */
export function taskSecretEntries(): MaskSecret[] {
  return [...nameByValue].map(([value, name]) => ({ name, value }));
}

/**
 * Takes in secret values with the variable each came from, and tells the
 * listeners when one is new. For a secret that is not in an env (a git
 * credential); the name is what an error tells the agent to use instead.
 */
export function recordTaskSecretEntries(
  entries: Iterable<[name: string, value: string]>,
): void {
  let added = false;

  for (const [name, value] of entries) {
    const known = nameByValue.get(value);

    added ||= known === undefined;

    // A real variable name is never replaced by the generic credential name,
    // which only stands in until the value turns up under its own name.
    if (known === undefined || known === GIT_CREDENTIAL_NAME) {
      nameByValue.set(value, name);
    }
  }

  if (added) {
    notifyTaskSecretsAdded(taskSecretValues());
  }
}

export function resetTaskSecretRegistryForTesting(): void {
  nameByValue.clear();
  clearTaskSecretListenersForTesting();
}
