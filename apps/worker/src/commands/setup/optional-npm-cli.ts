import type { StartupLogger } from '../../logging';

import { activateInstalledCli } from './activate-installed-cli';
import {
  npmInstallIntoPrefix,
  resolveInstalledBinaryPath,
} from './cli-binaries';
import { readInstalledCliVersion } from './cli-version';
import { formatDurationMs } from './logging';

/**
 * An npm CLI installed only when a deployment opts into it (Zero, Argent).
 * Each one gets its own `--prefix` root: `npm install --no-save` reifies the
 * prefix's node_modules down to just the requested package, so sharing a
 * root would delete another CLI's packages.
 */
interface OptionalNpmCli {
  command: string;
  label: string;
  packageName: string;
  expectedVersion: string;
  installRoot: string;
  /** Extra environment for `npm install` only. */
  installEnv?: Record<string, string>;
  /** Exported by the PATH wrapper on every invocation. */
  wrapperEnv?: Record<string, string>;
  /** Absolute Node binary the wrapper runs the CLI with. */
  wrapperNode?: string;
}

export type OptionalNpmCliLogger =
  | StartupLogger
  | Pick<Console, 'log' | 'info' | 'warn' | 'error'>;

/**
 * Installs `cli` at its expected version unless that version is already on
 * PATH, then validates both the installed binary and the PATH wrapper.
 * Throws on failure so the caller decides whether the run can continue.
 */
export async function installOptionalNpmCli(
  cli: OptionalNpmCli,
  logger: OptionalNpmCliLogger,
): Promise<void> {
  // Discriminate on `userLog`: console-shaped loggers (Node's console
  // included) also expose a `debug()` method, which is not a log channel.
  const debug = 'userLog' in logger ? logger.debug : logger;
  const installedVersion = await readInstalledCliVersion(cli.command);

  if (installedVersion === cli.expectedVersion) {
    return;
  }

  const installStartedAt = Date.now();
  const binaryPath = resolveInstalledBinaryPath(cli);

  try {
    debug.log(
      installedVersion
        ? `${cli.label} version mismatch (${installedVersion}); installing ${cli.expectedVersion}`
        : `${cli.label} missing; installing ${cli.expectedVersion}`,
    );

    await npmInstallIntoPrefix(
      cli.installRoot,
      [`${cli.packageName}@${cli.expectedVersion}`],
      cli.installEnv,
    );
    const validatedVersion = await activateInstalledCli({
      command: cli.command,
      expectedVersion: cli.expectedVersion,
      binaryPath,
      wrappers: [
        {
          command: cli.command,
          binaryPath,
          env: cli.wrapperEnv,
          node: cli.wrapperNode,
        },
      ],
    });

    debug.log(
      `${cli.label} installed at ${validatedVersion} in ${formatDurationMs(Date.now() - installStartedAt)}`,
    );
  } catch (error) {
    debug.error(
      `Failed to install ${cli.label}: ${error instanceof Error ? error.message : String(error)}`,
    );

    throw error;
  }
}
