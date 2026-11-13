import os from 'node:os';
import * as readline from 'node:readline';

import { execa, type ResultPromise } from 'execa';

import { redactSecrets } from '@roomote/communication/redact-secrets';

import type { HarnessLogger } from '../../../../logging';
import { HarnessStartError } from '../../harness-start-error';
import { createPrefixedLogger } from '../logging';

import { trackAgentProcess } from './track-agent-process';
import { maskText, type SecretSet } from './secret-mask';

export const DEFAULT_AGENT_COMMAND = {
  command: 'cursor-agent',
  args: ['acp'],
};

/**
 * Spawns the agent with exactly `env` and mirrors its stderr to the harness
 * log, with the values of `secrets` masked: stderr is the agent's own
 * output, and it can echo a credential it was given. The agent leads its own
 * process group (`detached`) so the whole tree can be stopped together.
 * `buffer: false`: stdout is the protocol stream, consumed line by line;
 * buffering it as well would grow without bound over a long task.
 */
export function spawnCursorAgent(options: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cancelSignal: AbortSignal;
  logger: HarnessLogger;
  secrets: SecretSet;
}): ResultPromise {
  const subprocess = execa(options.command, options.args, {
    cwd: options.cwd,
    // cursor-agent keeps its auth and sessions under HOME.
    env: {
      ...options.env,
      HOME: options.env.HOME ?? process.env.HOME ?? os.homedir(),
    },
    extendEnv: false,
    detached: true,
    buffer: false,
  });
  void subprocess.catch(() => {});
  trackAgentProcess(subprocess, options.cancelSignal);

  if (subprocess.stderr) {
    const stderrLog = createPrefixedLogger(
      options.logger,
      '[cursor-agent:stderr]',
    );

    readline
      .createInterface({ input: subprocess.stderr, crlfDelay: Infinity })
      .on(
        'line',
        (line) =>
          line.trim() &&
          stderrLog.info(redactSecrets(maskText(line, options.secrets.values))),
      );
  }

  return subprocess;
}

export function requireCursorApiKey(env: Record<string, string>): void {
  if (!env.CURSOR_API_KEY?.trim()) {
    throw new HarnessStartError(
      'CURSOR_API_KEY is not set. Add a Cursor API key to the deployment to run tasks on a cursor/ model.',
      { retryable: false },
    );
  }
}

/** Initializes the harness, failing early if the agent dies first. */
export async function connectBeforeExit(
  harness: { connect: () => Promise<void> },
  subprocess: ResultPromise,
): Promise<void> {
  await Promise.race([
    harness.connect(),
    subprocess.then(
      () => {
        throw new Error('cursor-agent exited before it initialized.');
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
}
