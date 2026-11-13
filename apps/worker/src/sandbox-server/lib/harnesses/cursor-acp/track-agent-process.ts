import type { ResultPromise } from 'execa';

import { groupExists } from './agent-process-group';
import { killAgentTree } from './agent-process-tree';
import { releaseAgent, trackAgent, trackedAgents } from './agent-registry';
import { killAgentsOnShutdown } from './agent-shutdown';

function killAllAgents(): void {
  trackedAgents().forEach((agent) => killAgentTree(agent, 'SIGKILL'));
}

/**
 * Makes sure the agent tree ends with the task: when the task is cancelled,
 * and when this process ends (a detached process is not stopped by it).
 * Tracking ends once the agent's group is empty.
 */
export function trackAgentProcess(
  subprocess: ResultPromise,
  cancelSignal: AbortSignal,
): void {
  const stop = () => killAgentTree(subprocess);

  if (cancelSignal.aborted) {
    stop();
  } else {
    cancelSignal.addEventListener('abort', stop, { once: true });
  }

  trackAgent(subprocess, () => cancelSignal.removeEventListener('abort', stop));
  killAgentsOnShutdown(killAllAgents);
  subprocess.once('exit', () => {
    if (subprocess.pid === undefined || !groupExists(subprocess.pid)) {
      releaseAgent(subprocess);
    }
  });
}
