import type { ResultPromise } from 'execa';

import { groupExists, hasExited } from './agent-process-group';
import { releaseAgent } from './agent-registry';

const FORCE_KILL_AFTER_MS = 5_000;
const POLL_MS = 250;
const escalating = new WeakSet<ResultPromise>();

/**
 * Signals the agent and everything it started. The agent runs as the leader
 * of its own process group, so its stdio MCP servers and any command it left
 * running are reached too; a plain kill would leave them behind. Members can
 * outlive the agent, so an exited agent's group is signalled as long as it
 * still has some. A SIGTERM that is not obeyed is followed by SIGKILL.
 */
export function killAgentTree(
  subprocess: ResultPromise,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  const { pid } = subprocess;

  if (pid === undefined) return;

  const leaderAlive = !hasExited(subprocess);

  if (!leaderAlive && !groupExists(pid)) {
    releaseAgent(subprocess);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    // No group of its own: signal the agent alone.
    if (leaderAlive) subprocess.kill(signal);
    return;
  }

  if (signal === 'SIGTERM') forceKillAfterGrace(subprocess, pid);
}

/** Polls the group so SIGKILL is only sent while it has been seen alive. */
function forceKillAfterGrace(subprocess: ResultPromise, pid: number): void {
  if (escalating.has(subprocess)) return;

  escalating.add(subprocess);
  let waited = 0;
  const timer = setInterval(() => {
    waited += POLL_MS;
    const gone = !groupExists(pid);

    if (!gone && waited < FORCE_KILL_AFTER_MS) return;

    clearInterval(timer);
    escalating.delete(subprocess);
    // An empty group is released by this call's own probe.
    killAgentTree(subprocess, 'SIGKILL');
  }, POLL_MS);
  timer.unref();
}
