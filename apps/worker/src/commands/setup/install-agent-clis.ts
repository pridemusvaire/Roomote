import * as fs from 'node:fs';

import { resolveWorkerRuntimePaths } from '@roomote/types';

import type { StartupLogger } from '../../logging';

import { getInstallers, type Installer } from './agent-cli-installers';
import { activateInstalledCli } from './activate-installed-cli';
import {
  npmInstallIntoPrefix,
  resolveInstalledBinaryPath,
} from './cli-binaries';
import { readInstalledCliVersion } from './cli-version';
import { formatDurationMs } from './logging';
import {
  getSharedSandboxRuntimePackageSpecs,
  usesSharedSandboxRuntimePackages,
} from './shared-runtime-packages';

async function installAgentCli(
  item: Installer,
  installers: Installer[],
  installedVersion: string | null,
  logger: StartupLogger,
): Promise<void> {
  const runtimePaths = resolveWorkerRuntimePaths({ existsSync: fs.existsSync });
  const installStartedAt = Date.now();
  const installRoot = runtimePaths.sandboxRootDir;
  const binaryPath = (command: string) =>
    resolveInstalledBinaryPath({ installRoot, command });

  logger.debug.log(
    installedVersion
      ? `${item.label} version mismatch (${installedVersion}); installing ${item.expectedVersion}`
      : `${item.label} missing; installing ${item.expectedVersion}`,
  );

  const usesSharedNpmPackageSet =
    usesSharedSandboxRuntimePackages(runtimePaths);

  await npmInstallIntoPrefix(
    installRoot,
    usesSharedNpmPackageSet
      ? getSharedSandboxRuntimePackageSpecs(process.env)
      : [`${item.packageName}@${item.expectedVersion}`],
  );
  // The shared package set reinstalls every CLI, so refresh every wrapper.
  const validatedVersion = await activateInstalledCli({
    command: item.command,
    expectedVersion: item.expectedVersion,
    binaryPath: binaryPath(item.command),
    wrappers: (usesSharedNpmPackageSet ? installers : [item]).map(
      (installer) => ({
        command: installer.command,
        binaryPath: binaryPath(installer.command),
      }),
    ),
  });

  logger.debug.log(
    `${item.label} installed at ${validatedVersion} in ${formatDurationMs(Date.now() - installStartedAt)}`,
  );
}

/**
 * Ensures external CLIs needed for interactive authentication flows are
 * available at the expected version. The worker image bakes them in, while
 * this installer remains as a compatibility fallback for older images and
 * local environments.
 */
export async function installAgentClis(logger: StartupLogger): Promise<void> {
  const installers = getInstallers();

  for (const item of installers) {
    const installedVersion = await readInstalledCliVersion(item.command);

    if (installedVersion === item.expectedVersion) {
      continue;
    }

    try {
      await installAgentCli(item, installers, installedVersion, logger);
    } catch (error) {
      logger.debug.error(
        `Failed to install ${item.label}: ${error instanceof Error ? error.message : String(error)}`,
      );

      throw error;
    }
  }
}
