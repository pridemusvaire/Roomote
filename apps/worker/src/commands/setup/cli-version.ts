import { execa } from 'execa';

/** Version probing for npm-installed sandbox CLIs. */

function parseInstalledCliVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/u.exec(output.trim());
  return match?.[1] ?? null;
}

export async function readInstalledCliVersion(
  command: string,
): Promise<string | null> {
  try {
    const { exitCode, stdout, stderr } = await execa(command, ['--version'], {
      reject: false,
      stdin: 'ignore',
    });

    if (exitCode !== 0) {
      return null;
    }

    return parseInstalledCliVersion([stdout, stderr].join('\n'));
  } catch {
    return null;
  }
}

/** Throws unless `command --version` at `where` reported `expected`. */
export async function assertInstalledCliVersion(options: {
  command: string;
  expected: string;
  where: string;
}): Promise<string> {
  const found = await readInstalledCliVersion(options.command);

  if (found !== options.expected) {
    throw new Error(
      `expected ${options.expected} ${options.where}, found ${found ?? 'unknown'}`,
    );
  }

  return found;
}
