import { onExit } from 'signal-exit';

const registered = new Set<() => void>();

/**
 * Runs `killAll` when this process is about to end, so no agent outlives it
 * (a detached agent is not stopped with its parent). A terminating signal
 * with a handler no longer kills Node, and the controller reaps workers with
 * SIGTERM, so `exit` alone is not enough.
 *
 * Goes through `signal-exit`, which execa has already hooked: it keeps one set
 * of signal handlers for every caller and re-raises the signal once they have
 * all run, so the process still dies by it. A handler of our own beside it
 * would make it believe someone else owns shutdown and neither would re-raise.
 * Safe to call on every spawn: `killAll` is registered once.
 */
export function killAgentsOnShutdown(killAll: () => void): void {
  if (!registered.has(killAll)) {
    registered.add(killAll);
    onExit(killAll);
  }
}
