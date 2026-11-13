type Listener = (values: string[]) => void;

const listeners = new Set<Listener>();

/**
 * Calls `listener` with every secret value the task has whenever a new one
 * arrives, so whatever masks the agent's output (the live harness) learns of a
 * secret that reached the task after it started, from any path. Returns the
 * unsubscribe.
 */
export function onTaskSecretsAdded(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function notifyTaskSecretsAdded(values: string[]): void {
  listeners.forEach((listener) => listener(values));
}

export function clearTaskSecretListenersForTesting(): void {
  listeners.clear();
}
