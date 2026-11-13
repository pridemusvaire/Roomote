import * as fs from 'node:fs';

import { resolveWorkerRuntimePaths } from '@roomote/types';

import {
  installOptionalNpmCli,
  type OptionalNpmCliLogger,
} from './optional-npm-cli';
import {
  resolveExpectedZeroCliVersion,
  resolveZeroCliInstallRoot,
  ZERO_CLI_PACKAGE_NAME,
} from './shared-runtime-packages';

export { installAgentClis } from './install-agent-clis';
export {
  DEFAULT_OPENCODE_CLI_VERSION,
  DEFAULT_ZERO_CLI_VERSION,
  ROOMOTE_BAKED_OPENCODE_CLI_VERSION_ENV,
  ROOMOTE_BAKED_ZERO_CLI_VERSION_ENV,
  ROOMOTE_OPENCODE_CLI_VERSION_ENV,
  ROOMOTE_ZERO_CLI_VERSION_ENV,
} from './shared-runtime-packages';

/**
 * Installs the Zero CLI only when the Zero integration is admin-enabled for
 * the deployment. Kept out of unconditional setup so non-Zero sandboxes never
 * pay for the package or surface the binary.
 */
export async function installZeroCli(
  logger: OptionalNpmCliLogger,
): Promise<void> {
  await installOptionalNpmCli(
    {
      command: 'zero',
      label: 'Zero CLI',
      packageName: ZERO_CLI_PACKAGE_NAME,
      expectedVersion: resolveExpectedZeroCliVersion(process.env),
      installRoot: resolveZeroCliInstallRoot(
        resolveWorkerRuntimePaths({ existsSync: fs.existsSync }),
      ),
    },
    logger,
  );
}
