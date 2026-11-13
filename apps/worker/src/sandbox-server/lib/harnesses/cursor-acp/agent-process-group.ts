import type { ResultPromise } from 'execa';

export function hasExited(subprocess: ResultPromise): boolean {
  return subprocess.exitCode !== null || subprocess.signalCode !== null;
}

/**
 * Whether anything is left in process group `pgid`. A group id stays reserved
 * while it has members, so this is only trustworthy for a group seen alive
 * since the agent led it; once it reads empty the id may be handed to an
 * unrelated process and must never be signalled again.
 */
export function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
