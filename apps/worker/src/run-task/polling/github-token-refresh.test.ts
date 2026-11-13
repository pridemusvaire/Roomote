import {
  engageCredentialWriteBarrier,
  resetCredentialWriteBarrierForTesting,
} from '../../lib/credential-write-barrier';

import {
  onTaskSecretsAdded,
  resetTaskSecretsForTesting,
  taskSecretValues,
  useMaskSecretsFile,
} from '../../lib/task-secrets';

import {
  createGitHubTokenRefreshInterval,
  refreshGitHubToken,
} from './github-token-refresh';

const {
  mockRefreshGitHubTokenWithMetadata,
  mockApplyMetadata,
  mockEnsureFiles,
  mockWriteMaskFile,
} = vi.hoisted(() => ({
  mockRefreshGitHubTokenWithMetadata: vi.fn(),
  mockApplyMetadata: vi.fn(),
  mockEnsureFiles: vi.fn(),
  mockWriteMaskFile: vi.fn(),
}));

vi.mock('../../lib/mask-secrets-file', () => ({
  writeMaskSecretsFile: mockWriteMaskFile,
  removeMaskSecretsFile: vi.fn(),
}));

vi.mock('@roomote/sdk/client', () => ({
  sdk: {
    taskRuns: {
      refreshGitHubTokenWithMetadata: mockRefreshGitHubTokenWithMetadata,
    },
  },
}));

vi.mock('../../lib/github-token', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/github-token')>();

  return {
    ...actual,
    applySourceControlTokenMetadata: mockApplyMetadata,
    ensureSourceControlTokenEnvFiles: mockEnsureFiles,
  };
});

function createLogger() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}

async function flushAsync() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe('createGitHubTokenRefreshInterval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCredentialWriteBarrierForTesting();
    resetTaskSecretsForTesting();
    mockRefreshGitHubTokenWithMetadata.mockResolvedValue({
      provider: 'github',
      source: 'app',
      expiresAt: null,
      nextRefreshAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    });
  });

  it('refreshes and writes token files while the barrier is disengaged', async () => {
    const interval = createGitHubTokenRefreshInterval({
      runId: 7,
      logger: createLogger(),
    });

    await flushAsync();
    clearInterval(interval);

    expect(mockRefreshGitHubTokenWithMetadata).toHaveBeenCalledWith({
      runId: 7,
    });
    expect(mockEnsureFiles).toHaveBeenCalled();
    expect(mockApplyMetadata).toHaveBeenCalled();
  });

  it('skips refreshes once the credential write barrier is engaged', async () => {
    await engageCredentialWriteBarrier();

    const interval = createGitHubTokenRefreshInterval({
      runId: 7,
      logger: createLogger(),
    });

    await flushAsync();
    clearInterval(interval);

    expect(mockRefreshGitHubTokenWithMetadata).not.toHaveBeenCalled();
    expect(mockEnsureFiles).not.toHaveBeenCalled();
    expect(mockApplyMetadata).not.toHaveBeenCalled();
  });

  it('defers the first refresh when the bootstrap token expiry is known', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));

    try {
      const interval = createGitHubTokenRefreshInterval({
        runId: 7,
        logger: createLogger(),
        initialExpiresAt: new Date('2026-08-24T13:00:00.000Z'),
      });

      await flushAsync();
      expect(mockRefreshGitHubTokenWithMetadata).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(45 * 60 * 1000);
      await flushAsync();
      clearInterval(interval);

      expect(mockRefreshGitHubTokenWithMetadata).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('refreshGitHubToken and the secrets the agent can see', () => {
  const PROVIDERS = [
    ['github', 'GH_TOKEN'],
    ['gitlab', 'GITLAB_TOKEN'],
    ['gitea', 'GITEA_TOKEN'],
    ['ado', 'ADO_TOKEN'],
    ['bitbucket', 'BITBUCKET_OAUTH'],
  ] as const;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetCredentialWriteBarrierForTesting();
    resetTaskSecretsForTesting();
    await useMaskSecretsFile(true);
    mockWriteMaskFile.mockClear();
  });

  it.each(PROVIDERS)(
    'records, announces and writes a rotated %s token',
    async (provider, envVar) => {
      const announced = vi.fn();
      onTaskSecretsAdded(announced);
      mockRefreshGitHubTokenWithMetadata.mockResolvedValue({
        provider,
        source: 'app',
        expiresAt: null,
        nextRefreshAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        envVar,
        envVars: { [envVar]: 'rotated-token-value' },
      });

      await refreshGitHubToken({ runId: 7, logger: createLogger() });

      expect(taskSecretValues()).toEqual(['rotated-token-value']);
      expect(announced).toHaveBeenCalledWith(['rotated-token-value']);
      expect(mockWriteMaskFile).toHaveBeenLastCalledWith([
        { name: envVar, value: 'rotated-token-value' },
      ]);
      expect(mockApplyMetadata).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the first token masked after a second refresh', async () => {
    for (const token of ['first-token-value', 'second-token-value']) {
      mockRefreshGitHubTokenWithMetadata.mockResolvedValueOnce({
        provider: 'gitlab',
        source: 'user',
        expiresAt: null,
        nextRefreshAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        envVars: { GITLAB_TOKEN: token },
      });
      await refreshGitHubToken({ runId: 7, logger: createLogger() });
    }

    expect(taskSecretValues()).toEqual([
      'first-token-value',
      'second-token-value',
    ]);
  });

  it('does not refresh the file a snapshot scrubbed, but still masks the token live', async () => {
    const announced = vi.fn();
    onTaskSecretsAdded(announced);
    mockRefreshGitHubTokenWithMetadata.mockResolvedValue({
      provider: 'github',
      source: 'app',
      expiresAt: null,
      nextRefreshAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      envVars: { GH_TOKEN: 'rotated-token-value' },
    });
    await engageCredentialWriteBarrier();

    await refreshGitHubToken({ runId: 7, logger: createLogger() });

    expect(announced).toHaveBeenCalledWith(['rotated-token-value']);
    expect(mockWriteMaskFile).not.toHaveBeenCalled();
  });
});
