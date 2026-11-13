import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const { home } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: joinPath } = await import('node:path');
  return { home: mkdtempSync(joinPath(tmpdir(), 'roomote-env-shell-')) };
});

vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: () => home,
}));

const { injectEnvVars } = await import('../utils/env-vars');

const ENV = {
  CURSOR_API_KEY: 'cursor-key-value',
  OPENAI_API_KEY: 'sk-openai-value',
  CUSTOM_PROVIDER_KEY: 'custom-provider-value',
  R_MODEL_ENV_KEYS: 'CUSTOM_PROVIDER_KEY',
  AWS_REGION: 'eu-west-1',
  REPO_DATABASE_URL: 'postgres://repo-db',
};

/** The variables a bash the agent starts ends up with. */
function shellEnv(options: {
  omitProviderKeys: boolean;
  interactive: boolean;
}) {
  const output = execFileSync(
    'bash',
    [...(options.interactive ? ['-i'] : []), '-c', 'env'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: home,
        BASH_ENV: join(home, '.roomote', 'env.sh'),
        ...(options.omitProviderKeys
          ? { ROOMOTE_OMIT_MODEL_PROVIDER_KEYS: '1' }
          : {}),
      },
    },
  );

  return Object.fromEntries(
    output
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

describe.each([
  ['a repository workspace', false],
  ['an environment workspace', true],
])('the shell env file in %s', (_name, isEnvironment) => {
  beforeAll(async () => {
    await injectEnvVars({ ...ENV }, undefined, {
      syncSourceControlTokenFiles: false,
      omitInheritedModelRuntimeEnvFromShell: isEnvironment,
      explicitShellEnvVars: isEnvironment
        ? { REPO_DATABASE_URL: ENV.REPO_DATABASE_URL }
        : undefined,
    });
  });

  describe.each([
    ['non-interactive', false],
    ['interactive', true],
  ])('for a %s shell', (_kind, interactive) => {
    it('keeps other providers’ keys out of the Cursor agent’s shell, the rest in', () => {
      const env = shellEnv({ omitProviderKeys: true, interactive });

      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.CUSTOM_PROVIDER_KEY).toBeUndefined();
      expect(env.CURSOR_API_KEY).toBe('cursor-key-value');
      expect(env.AWS_REGION).toBe('eu-west-1');
      expect(env.REPO_DATABASE_URL).toBe('postgres://repo-db');
    });

    it('still loads every key into a shell not started for the Cursor agent', () => {
      const env = shellEnv({ omitProviderKeys: false, interactive });

      expect(env.OPENAI_API_KEY).toBe('sk-openai-value');
      expect(env.CUSTOM_PROVIDER_KEY).toBe('custom-provider-value');
    });
  });
});
