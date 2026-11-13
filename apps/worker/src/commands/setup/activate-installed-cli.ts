import { ensureCliWrappers } from './cli-binaries';
import { assertInstalledCliVersion } from './cli-version';

/**
 * After an npm install: checks the installed binary reports the expected
 * version, writes the PATH wrappers, then checks `<command> --version` on PATH
 * resolves to it. Returns the validated version.
 */
export async function activateInstalledCli(options: {
  command: string;
  expectedVersion: string;
  binaryPath: string;
  wrappers: Array<{
    command: string;
    binaryPath: string;
    env?: Record<string, string>;
    node?: string;
  }>;
}): Promise<string> {
  await assertInstalledCliVersion({
    command: options.binaryPath,
    expected: options.expectedVersion,
    where: `at ${options.binaryPath}`,
  });

  for (const wrapper of options.wrappers) {
    ensureCliWrappers({
      commands: [wrapper.command],
      binaryPath: wrapper.binaryPath,
      env: wrapper.env,
      node: wrapper.node,
    });
  }

  return assertInstalledCliVersion({
    command: options.command,
    expected: options.expectedVersion,
    where: `from ${options.command} --version`,
  });
}
