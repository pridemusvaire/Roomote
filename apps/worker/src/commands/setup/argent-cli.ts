import * as fs from 'node:fs';

import {
  resolveWorkerRuntimePaths,
  type WorkerRuntimePaths,
} from '@roomote/types';

import {
  installOptionalNpmCli,
  type OptionalNpmCliLogger,
} from './optional-npm-cli';

/**
 * Argent (Software Mansion) drives iOS simulators and Android emulators.
 * Sandboxes are Linux, so they never run devices themselves: the CLI talks to
 * an operator-hosted Argent tool-server on a Mac through `ARGENT_TOOLS_URL`
 * (bearer token in `ARGENT_AUTH_TOKEN`), and uploads local `.apk`/`.app`
 * builds to it. Both are ordinary deployment environment variables, which the
 * Argent CLI reads natively from the agent's shell.
 */
const ARGENT_CLI_PACKAGE_NAME = '@swmansion/argent';
export const DEFAULT_ARGENT_CLI_VERSION = '0.33.0';
export const R_ARGENT_CLI_VERSION_ENV = 'R_ARGENT_CLI_VERSION';
const ARGENT_TOOLS_URL_ENV = 'ARGENT_TOOLS_URL';
export const ARGENT_SKILL_NAME = 'verify-on-device';

type EnvVars = Record<string, string | undefined>;

/** Reads the deployment env vars (not the worker's own process env). */
export function resolveExpectedArgentCliVersion(env: EnvVars): string {
  return env[R_ARGENT_CLI_VERSION_ENV]?.trim() || DEFAULT_ARGENT_CLI_VERSION;
}

/** True when the deployment points sandboxes at an HTTPS device host. */
export function isArgentDeviceHostConfigured(
  env: EnvVars | undefined,
): boolean {
  const value = env?.[ARGENT_TOOLS_URL_ENV]?.trim();

  if (!value) {
    return false;
  }

  try {
    const { protocol } = new URL(value);
    // HTTPS only: the bearer token must never cross the network in cleartext.
    return protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveArgentCliInstallRoot(runtimePaths: WorkerRuntimePaths): string {
  return `${runtimePaths.sandboxRootDir}/argent-cli`;
}

/**
 * Installs the Argent CLI only for deployments with a device host, so other
 * sandboxes never pay for the package (it ships native modules and macOS
 * device tooling) or surface the binary. Sandboxes only act as a client of
 * the remote host, so the optional Electron binary is never downloaded, and
 * the wrapper opts out of Argent's anonymous telemetry.
 */
export async function installArgentCli(
  logger: OptionalNpmCliLogger,
  deploymentEnvVars: EnvVars,
): Promise<void> {
  await installOptionalNpmCli(
    {
      command: 'argent',
      label: 'Argent CLI',
      packageName: ARGENT_CLI_PACKAGE_NAME,
      expectedVersion: resolveExpectedArgentCliVersion(deploymentEnvVars),
      installRoot: resolveArgentCliInstallRoot(
        resolveWorkerRuntimePaths({ existsSync: fs.existsSync }),
      ),
      installEnv: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
      wrapperEnv: { ARGENT_TELEMETRY: '0' },
      // Argent needs Node >= 20.12. Mobile repositories often pin an older
      // Node (.nvmrc, mise.toml) that would win inside the checkout.
      wrapperNode: process.execPath,
    },
    logger,
  );
}
