import * as os from 'node:os';
import * as path from 'node:path';
import type { PathLike } from 'node:fs';

import { execa } from 'execa';

const { mockExeca, mockExistsSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('execa', () => ({ execa: mockExeca }));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: vi.fn(),
  writeFileSync: mockWriteFileSync,
  chmodSync: vi.fn(),
}));

vi.mock('@roomote/types', () => ({
  resolveWorkerRuntimePaths: () => ({
    runtime: 'modal',
    sandboxRootDir: '/sandbox',
    workspaceReposDir: '/sandbox/repos',
    vscodeUserDataDir: '/sandbox/.vscode',
  }),
}));

import {
  DEFAULT_ARGENT_CLI_VERSION,
  R_ARGENT_CLI_VERSION_ENV,
  installArgentCli,
  isArgentDeviceHostConfigured,
  resolveExpectedArgentCliVersion,
} from '../argent-cli';

const MISE_NPM_PATH = '/opt/mise/installs/node/22.17.1/bin/npm';

function result(stdout: string) {
  return { exitCode: 0, stdout, stderr: '' } as Awaited<
    ReturnType<typeof execa>
  >;
}

const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('isArgentDeviceHostConfigured', () => {
  it.each([
    [undefined, false],
    [{}, false],
    [{ ARGENT_TOOLS_URL: '   ' }, false],
    [{ ARGENT_TOOLS_URL: 'not a url' }, false],
    [{ ARGENT_TOOLS_URL: 'ftp://devices.example.com' }, false],
    [{ ARGENT_TOOLS_URL: 'https://devices.example.com' }, true],
    // Plain HTTP would send the bearer token in cleartext.
    [{ ARGENT_TOOLS_URL: 'http://10.0.0.42:3001' }, false],
  ])('treats %j as configured=%s', (env, expected) => {
    expect(isArgentDeviceHostConfigured(env)).toBe(expected);
  });
});

describe('resolveExpectedArgentCliVersion', () => {
  it('pins the default version and honors the operator override', () => {
    expect(resolveExpectedArgentCliVersion({})).toBe(
      DEFAULT_ARGENT_CLI_VERSION,
    );
    expect(
      resolveExpectedArgentCliVersion({
        [R_ARGENT_CLI_VERSION_ENV]: ' 0.40.1 ',
      }),
    ).toBe('0.40.1');
  });
});

describe('installArgentCli', () => {
  it('installs the version pinned by the deployment env, not the worker env', async () => {
    process.env[R_ARGENT_CLI_VERSION_ENV] = '0.1.0';
    mockExeca
      .mockRejectedValueOnce(new Error('spawn argent ENOENT'))
      .mockResolvedValueOnce(result(MISE_NPM_PATH))
      .mockResolvedValueOnce(result(''))
      .mockResolvedValueOnce(result('0.40.1'))
      .mockResolvedValueOnce(result('0.40.1'));

    await installArgentCli(logger, {
      [R_ARGENT_CLI_VERSION_ENV]: '0.40.1',
    });

    expect(mockExeca).toHaveBeenNthCalledWith(
      3,
      MISE_NPM_PATH,
      expect.arrayContaining(['@swmansion/argent@0.40.1']),
      expect.anything(),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[R_ARGENT_CLI_VERSION_ENV];
    mockExistsSync.mockImplementation(
      (target: PathLike) => target === '/sandbox',
    );
  });

  it('does nothing when the pinned version is already on PATH', async () => {
    mockExeca.mockResolvedValueOnce(result(DEFAULT_ARGENT_CLI_VERSION));

    await installArgentCli(logger, {});

    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('installs into its own prefix and puts a wrapper on PATH', async () => {
    mockExeca
      .mockRejectedValueOnce(new Error('spawn argent ENOENT'))
      .mockResolvedValueOnce(result(MISE_NPM_PATH))
      .mockResolvedValueOnce(result(''))
      .mockResolvedValueOnce(result(DEFAULT_ARGENT_CLI_VERSION))
      .mockResolvedValueOnce(result(DEFAULT_ARGENT_CLI_VERSION));

    await installArgentCli(logger, {});

    expect(mockExeca).toHaveBeenNthCalledWith(
      3,
      MISE_NPM_PATH,
      [
        'install',
        '--prefix',
        '/sandbox/argent-cli',
        '--no-save',
        '--no-package-lock',
        `@swmansion/argent@${DEFAULT_ARGENT_CLI_VERSION}`,
      ],
      // Client-only install: never download the optional Electron binary.
      { stdin: 'ignore', env: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } },
    );
    // The wrapper opts every invocation out of Argent's telemetry
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.local', 'bin', 'argent'),
      // and runs on the worker's Node, never a repository's pinned one.
      `#!/bin/bash\nexport ARGENT_TELEMETRY="0"\nexec ${JSON.stringify(process.execPath)} "/sandbox/argent-cli/node_modules/.bin/argent" "$@"\n`,
      'utf8',
    );
  });

  it('fails loudly when the installed binary reports the wrong version', async () => {
    mockExeca
      .mockRejectedValueOnce(new Error('spawn argent ENOENT'))
      .mockResolvedValueOnce(result(MISE_NPM_PATH))
      .mockResolvedValueOnce(result(''))
      .mockResolvedValueOnce(result('0.1.0'));

    await expect(installArgentCli(logger, {})).rejects.toThrow(
      `expected ${DEFAULT_ARGENT_CLI_VERSION} at /sandbox/argent-cli/node_modules/.bin/argent, found 0.1.0`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to install Argent CLI'),
    );
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('logs through console-shaped loggers that also have a debug() method', async () => {
    // Node's console (and similar loggers) expose `debug` as a function, so
    // the channel must not be picked by `'debug' in logger`.
    const consoleLike = { ...logger, debug: vi.fn() };
    mockExeca
      .mockRejectedValueOnce(new Error('spawn argent ENOENT'))
      .mockResolvedValueOnce(result(MISE_NPM_PATH))
      .mockRejectedValueOnce(new Error('npm install failed'));

    await expect(installArgentCli(consoleLike, {})).rejects.toThrow(
      'npm install failed',
    );
    expect(consoleLike.log).toHaveBeenCalledWith(
      expect.stringContaining('Argent CLI missing'),
    );
    expect(consoleLike.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to install Argent CLI: npm install failed',
      ),
    );
  });
});
