import * as fs from 'node:fs';

import {
  installArgentCli,
  isArgentDeviceHostConfigured,
} from '../commands/setup/argent-cli';

type DeviceHostLogger = Pick<Console, 'log' | 'info' | 'warn' | 'error'>;

/**
 * The background install's outcome, for the `verify-on-device` skill, which
 * names these exact paths. `argent` on PATH is not a readiness signal: on a
 * resumed sandbox an older wrapper already exists while npm reinstalls.
 */
export const ARGENT_INSTALL_READY_MARKER = '/tmp/roomote-argent-install-ready';
export const ARGENT_INSTALL_FAILED_MARKER =
  '/tmp/roomote-argent-install-failed';

/** Best effort: without a marker the skill still times out waiting. */
function setMarker(marker: string | null): void {
  for (const path of [
    ARGENT_INSTALL_READY_MARKER,
    ARGENT_INSTALL_FAILED_MARKER,
  ]) {
    try {
      if (path === marker) {
        fs.writeFileSync(path, `${new Date().toISOString()}\n`);
      } else {
        fs.rmSync(path, { force: true });
      }
    } catch {
      // Ignored: see above.
    }
  }
}

/**
 * Enables on-device verification when the deployment configures an Argent
 * device host, and starts the CLI install in the background.
 *
 * The first install builds native modules and takes one to three minutes, so
 * it must not delay task startup for every task in the deployment, mobile or
 * not. The skill waits for the ready or failed marker. A failed install is
 * logged and never fails the task.
 *
 * Returns the in-flight install so callers and tests can observe it.
 */
export function startArgentDeviceHost(
  deploymentEnvVars: Record<string, string | undefined>,
  logger: DeviceHostLogger,
): { enabled: boolean; installed: Promise<boolean> } {
  if (!isArgentDeviceHostConfigured(deploymentEnvVars)) {
    return { enabled: false, installed: Promise.resolve(false) };
  }

  // Markers left by an earlier run on a resumed sandbox are stale.
  setMarker(null);

  const installed = installArgentCli(logger, deploymentEnvVars).then(
    () => {
      setMarker(ARGENT_INSTALL_READY_MARKER);
      return true;
    },
    (error: unknown) => {
      logger.warn(
        `[runTask] Failed to install Argent CLI; device verification is unavailable for this run: ${error instanceof Error ? error.message : String(error)}`,
      );
      setMarker(ARGENT_INSTALL_FAILED_MARKER);
      return false;
    },
  );

  return { enabled: true, installed };
}
