import type { ResultPromise } from 'execa';

/**
 * Agents whose process group may still have members, each with what stops
 * tracking it (a cancel listener). An agent leaves once its group has been
 * seen empty, so nothing accumulates over a long task.
 */
const tracked = new Map<ResultPromise, () => void>();

export function trackAgent(
  subprocess: ResultPromise,
  untrack: () => void,
): void {
  tracked.set(subprocess, untrack);
}

export function releaseAgent(subprocess: ResultPromise): void {
  tracked.get(subprocess)?.();
  tracked.delete(subprocess);
}

export function trackedAgents(): ResultPromise[] {
  return [...tracked.keys()];
}
