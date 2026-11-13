import type { ResultPromise } from 'execa';

import type { AcpConnection } from './acp-connection';

/** Time for the last output of an exited agent to be read before closing. */
const EXIT_DRAIN_MS = 250;

/**
 * Closes the connection once the agent has exited. The pipe normally ends
 * with it, but a process the agent left behind can hold stdout open, and a
 * dead agent would then look alive for ever.
 */
export function closeOnAgentExit(
  subprocess: ResultPromise,
  connection: AcpConnection,
): void {
  subprocess.once('exit', () =>
    setTimeout(() => connection.close(), EXIT_DRAIN_MS),
  );
}
