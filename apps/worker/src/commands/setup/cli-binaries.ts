import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { execa } from 'execa';

import { resolveNpmInstallCommand } from './npm-install-command';

/**
 * Install layout for npm-installed sandbox CLIs: the `node_modules/.bin`
 * layout of a `--prefix` install and the `~/.local/bin` wrappers that put
 * each CLI on the agent's PATH.
 */

export function ensureCliWrappers(options: {
  commands: string[];
  binaryPath: string;
  /** Exported by the wrapper before exec, e.g. a CLI's telemetry opt-out. */
  env?: Record<string, string>;
  /** Absolute Node binary to run the CLI with, ignoring per-repo Node pins. */
  node?: string;
}): void {
  const binDir = path.join(os.homedir(), '.local', 'bin');

  fs.mkdirSync(binDir, { recursive: true });

  for (const command of options.commands) {
    const wrapperPath = path.join(binDir, command);

    fs.writeFileSync(
      wrapperPath,
      [
        '#!/bin/bash',
        ...Object.entries(options.env ?? {}).map(
          ([name, value]) => `export ${name}=${JSON.stringify(value)}`,
        ),
        `exec ${[options.node, options.binaryPath]
          .filter((part): part is string => Boolean(part))
          .map((part) => JSON.stringify(part))
          .join(' ')} "$@"`,
        '',
      ].join('\n'),
      'utf8',
    );
    fs.chmodSync(wrapperPath, 0o755);
  }
}

/** `npm install --prefix <root>` without touching any package.json/lockfile. */
export async function npmInstallIntoPrefix(
  installRoot: string,
  packageSpecs: string[],
  env?: Record<string, string>,
): Promise<void> {
  const npmInstallCommand = await resolveNpmInstallCommand();

  fs.mkdirSync(installRoot, { recursive: true });

  await execa(
    npmInstallCommand.command,
    [
      ...npmInstallCommand.argsPrefix,
      'install',
      '--prefix',
      installRoot,
      '--no-save',
      '--no-package-lock',
      ...packageSpecs,
    ],
    env ? { stdin: 'ignore', env } : { stdin: 'ignore' },
  );
}

export function resolveInstalledBinaryPath(options: {
  installRoot: string;
  command: string;
}): string {
  return path.join(
    options.installRoot,
    'node_modules',
    '.bin',
    options.command,
  );
}
