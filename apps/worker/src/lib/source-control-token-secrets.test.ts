const { applyMock, writeMock, removeMock } = vi.hoisted(() => ({
  applyMock: vi.fn(),
  writeMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('./github-token', () => ({
  applySourceControlTokenMetadata: applyMock,
}));
vi.mock('./mask-secrets-file', () => ({
  writeMaskSecretsFile: writeMock,
  removeMaskSecretsFile: removeMock,
}));

import {
  engageCredentialWriteBarrier,
  resetCredentialWriteBarrierForTesting,
} from './credential-write-barrier';
import { applySourceControlTokens } from './source-control-token-secrets';
import {
  onTaskSecretsAdded,
  resetTaskSecretsForTesting,
  taskSecretValues,
  useMaskSecretsFile,
} from './task-secrets';

const PROVIDER_ENV_VARS = [
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'GITEA_TOKEN',
  'ADO_TOKEN',
  'BITBUCKET_OAUTH',
] as const;

beforeEach(async () => {
  vi.clearAllMocks();
  resetTaskSecretsForTesting();
  resetCredentialWriteBarrierForTesting();
  await useMaskSecretsFile(true);
  writeMock.mockClear();
});

describe('applySourceControlTokens', () => {
  it.each(PROVIDER_ENV_VARS)(
    'makes a rotated %s a secret: recorded, announced to the harness, written to the file',
    async (envVar) => {
      const announced = vi.fn();
      onTaskSecretsAdded(announced);

      await applySourceControlTokens({
        envVars: { [envVar]: 'rotated-token-9' },
      });

      expect(applyMock).toHaveBeenCalledTimes(1);
      expect(taskSecretValues()).toEqual(['rotated-token-9']);
      expect(announced).toHaveBeenCalledWith(['rotated-token-9']);
      expect(writeMock).toHaveBeenLastCalledWith([
        { name: envVar, value: 'rotated-token-9' },
      ]);
    },
  );

  it('keeps the value it replaced masked', async () => {
    await applySourceControlTokens({
      envVars: { GITLAB_TOKEN: 'first-token-1' },
    });
    await applySourceControlTokens({
      envVars: { GITLAB_TOKEN: 'second-token-2' },
    });

    expect(writeMock).toHaveBeenLastCalledWith([
      { name: 'GITLAB_TOKEN', value: 'first-token-1' },
      { name: 'GITLAB_TOKEN', value: 'second-token-2' },
    ]);
  });

  it('also takes in the tokens of other repositories, git and proxy', async () => {
    await applySourceControlTokens({
      envVars: { GH_TOKEN: 'primary-token-1' },
      gitCredentials: [
        {
          host: 'github.com',
          repositoryFullName: 'acme/api',
          username: 'x-access-token',
          token: 'installation-token-2',
        },
      ],
      gitProxyCredentials: [
        {
          provider: 'gitlab',
          host: 'gitlab.example.com',
          repositoryFullName: 'acme/web',
          username: 'oauth2',
          token: 'proxy-token-3',
        },
      ],
    });

    expect(taskSecretValues().sort()).toEqual([
      'installation-token-2',
      'primary-token-1',
      'proxy-token-3',
    ]);
  });

  it('takes only the token variables out of a whole task env', async () => {
    await applySourceControlTokens({
      envVars: {
        GH_TOKEN: 'primary-token-1',
        APP_NAME: 'plain-value',
        PATH: '/usr/bin',
      } as never,
    });

    expect(taskSecretValues()).toEqual(['primary-token-1']);
  });

  it('records the secret and rewrites the file before the token reaches the disk', async () => {
    const order: string[] = [];
    writeMock.mockImplementation(() => order.push('file'));
    applyMock.mockImplementation(async () => {
      order.push(`disk (known: ${taskSecretValues().length})`);
    });

    await applySourceControlTokens({
      envVars: { GH_TOKEN: 'rotated-token-9' },
    });

    expect(order).toEqual(['file', 'disk (known: 1)']);
  });

  it('clears the files and records nothing when there is no token', async () => {
    await applySourceControlTokens(null);

    expect(applyMock).toHaveBeenCalledWith(null);
    expect(taskSecretValues()).toEqual([]);
  });

  it('still records and announces while a snapshot holds the barrier, leaving the file for the restore', async () => {
    const announced = vi.fn();
    onTaskSecretsAdded(announced);
    await engageCredentialWriteBarrier();

    await applySourceControlTokens({
      envVars: { GH_TOKEN: 'rotated-token-9' },
    });

    expect(announced).toHaveBeenCalledWith(['rotated-token-9']);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('still writes the token files, and removes the mask file so the guard fails closed, when the mask file cannot be written', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeMock.mockImplementationOnce(() => {
      throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    });
    const tokens = { envVars: { GH_TOKEN: 'rotated-token-9' } };

    await expect(applySourceControlTokens(tokens)).resolves.toBeUndefined();

    expect(applyMock).toHaveBeenCalledWith(tokens);
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('no space left'),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('rotated-token-9');
    error.mockRestore();
  });

  it('names a git credential after the token variable only when the values are the same', async () => {
    await applySourceControlTokens({
      envVars: { GH_TOKEN: 'primary-token-1' },
      gitCredentials: [
        {
          host: 'github.com',
          repositoryFullName: 'acme/api',
          username: 'x-access-token',
          token: 'installation-token-2',
        },
        {
          host: 'github.com',
          repositoryFullName: 'acme/web',
          username: 'x-access-token',
          token: 'primary-token-1',
        },
      ],
    });

    expect(writeMock).toHaveBeenLastCalledWith([
      { name: 'GH_TOKEN', value: 'primary-token-1' },
      { name: 'GIT_CREDENTIAL', value: 'installation-token-2' },
    ]);
  });

  it('never replaces the real name of a value with a synthetic one', async () => {
    await applySourceControlTokens({
      envVars: { GH_TOKEN: 'primary-token-1' },
    });
    await applySourceControlTokens({
      envVars: {},
      gitCredentials: [
        {
          host: 'github.com',
          repositoryFullName: 'acme/api',
          username: 'x-access-token',
          token: 'primary-token-1',
        },
      ],
    });

    expect(writeMock).toHaveBeenLastCalledWith([
      { name: 'GH_TOKEN', value: 'primary-token-1' },
    ]);
  });
});
