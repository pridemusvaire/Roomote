import type { RunTokenContext } from '@roomote/types';

import { WorkerEnv } from '../../../env';
import {
  engageCredentialWriteBarrier,
  resetCredentialWriteBarrierForTesting,
} from '../../../lib/credential-write-barrier';
import {
  onTaskSecretsAdded,
  resetTaskSecretsForTesting,
  useMaskSecretsFile,
} from '../../../lib/task-secrets';
import { appRouter } from '../../routers';
import type { Context } from '../../trpc';

const {
  mockGetResolvedRuntimeEnvVars,
  mockFindFirstById,
  mockInjectEnvVars,
  mockWriteMaskSecretsFile,
} = vi.hoisted(() => ({
  mockGetResolvedRuntimeEnvVars: vi.fn(),
  mockFindFirstById: vi.fn(),
  mockInjectEnvVars: vi.fn(),
  mockWriteMaskSecretsFile: vi.fn(),
}));

vi.mock('../../../lib/mask-secrets-file', () => ({
  writeMaskSecretsFile: mockWriteMaskSecretsFile,
  removeMaskSecretsFile: vi.fn(),
}));

vi.mock('@roomote/sdk/client', () => ({
  sdk: {
    taskRuns: {
      getResolvedRuntimeEnvVars: mockGetResolvedRuntimeEnvVars,
      findFirstById: mockFindFirstById,
    },
  },
}));

vi.mock('../../../commands/utils/env-vars', () => ({
  injectEnvVars: mockInjectEnvVars,
}));

function createWorkerEnv() {
  const workerEnv = new WorkerEnv({
    systemBase: {
      HOME: '/home/testuser',
      PATH: '/usr/bin:/usr/local/bin',
      LC_ALL: 'C.UTF-8',
      NODE_ENV: 'test',
    },
    workerConfig: {
      authToken: 'secret-auth-token',
      trpcUrl: 'https://trpc.internal.example.com',
      previewProxyBaseUrl: 'https://preview.roomote.run',
      previewProxySubdomainSuffix: 'preview.roomote.run',
      roomoteAppUrl: 'https://app.roomote.example',
      appEnv: 'development',
    },
  });

  workerEnv.addServiceEnv({
    DATABASE_URL: 'postgres://localhost/test',
  });
  workerEnv.setRuntimeEnv({
    GH_TOKEN: 'gh-token',
    LEGACY_VALUE: 'old-value',
  });
  workerEnv.addUserEnv({
    NEXT_PUBLIC_API_BASE: 'https://workspace.example.test',
  });

  return workerEnv;
}

function createCaller(workerEnv?: WorkerEnv, runId = 1) {
  const commandEnv = {
    HOME: '/home/testuser',
    PATH: '/usr/bin:/usr/local/bin',
    LC_ALL: 'C.UTF-8',
    GH_TOKEN: 'gh-token',
    LEGACY_VALUE: 'old-value',
    ROOMOTE_TASK_ID: 'task-123',
    ROOMOTE_TASK_TYPE: 'standard',
    CLAUDE_APPEND_SYSTEM_PROMPT: 'follow the system instructions',
  };
  const setCommandEnv = vi.fn();
  const ctx = {
    workingDirectory: '/tmp',
    harness: {
      isConnected: true,
      getCommandEnv: () => ({ ...commandEnv }),
      setCommandEnv,
    },
    harnessManager: {
      getStatus: () => ({
        phase: 'running',
        taskStateEvent: null,
        sessionId: 'session-1',
        isConnected: true,
        sleepRemainingMs: 30_000,
      }),
    },
    auth: {
      runId,
      userId: 'user-1',
      principal: 'user',
      tokenType: 'run',
      version: 1,
    } satisfies RunTokenContext,
    runId,
    workerEnv,
  } as unknown as Context;

  return {
    caller: appRouter.createCaller(ctx),
    setCommandEnv,
  };
}

describe('reloadDeploymentEnvVars procedure', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetCredentialWriteBarrierForTesting();
    resetTaskSecretsForTesting();
    await useMaskSecretsFile(true);
    mockWriteMaskSecretsFile.mockClear();
    mockGetResolvedRuntimeEnvVars.mockResolvedValue({
      OPENAI_API_KEY: 'new-openai-key',
      ANTHROPIC_API_KEY: 'new-anthropic-key',
    });
    mockFindFirstById.mockResolvedValue({
      id: 1,
      taskId: 'task-123',
      payload: { repo: 'owner/repo' },
    });
    mockInjectEnvVars.mockImplementation(
      (env: Record<string, string | undefined>) => {
        env.BASH_ENV = '/tmp/roomote/env.sh';
      },
    );
  });

  it('replaces user env vars while preserving service env and shell wiring', async () => {
    const workerEnv = createWorkerEnv();
    const { caller, setCommandEnv } = createCaller(workerEnv);

    const result = await caller.commands.reloadDeploymentEnvVars();

    expect(result.success).toBe(true);
    expect(result.names).toEqual(
      expect.arrayContaining(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']),
    );
    expect(result.names).toHaveLength(2);
    expect(mockGetResolvedRuntimeEnvVars).toHaveBeenCalledWith({
      runId: 1,
    });
    expect(mockFindFirstById).toHaveBeenCalledWith(1);
    expect(mockInjectEnvVars).toHaveBeenCalledTimes(1);
    expect(mockInjectEnvVars).toHaveBeenCalledWith(
      expect.objectContaining({
        OPENAI_API_KEY: 'new-openai-key',
        ANTHROPIC_API_KEY: 'new-anthropic-key',
      }),
      { id: 1, taskId: 'task-123', payload: { repo: 'owner/repo' } },
      expect.objectContaining({
        previewProxyBaseUrl: 'https://preview.roomote.run',
        previewProxySubdomainSuffix: 'preview.roomote.run',
        syncSourceControlTokenFiles: false,
      }),
    );

    const reloadedEnv = workerEnv.buildUserFacingEnv();

    expect(reloadedEnv.DATABASE_URL).toBe('postgres://localhost/test');
    expect(reloadedEnv.OPENAI_API_KEY).toBe('new-openai-key');
    expect(reloadedEnv.ANTHROPIC_API_KEY).toBe('new-anthropic-key');
    expect(reloadedEnv.GH_TOKEN).toBeUndefined();
    expect(reloadedEnv.NEXT_PUBLIC_API_BASE).toBe(
      'https://workspace.example.test',
    );
    expect(reloadedEnv.BASH_ENV).toBe('/tmp/roomote/env.sh');
    expect(reloadedEnv.LEGACY_VALUE).toBeUndefined();
    expect(setCommandEnv).toHaveBeenCalledWith({
      HOME: '/home/testuser',
      PATH: '/usr/bin:/usr/local/bin',
      LC_ALL: 'C.UTF-8',
      OPENAI_API_KEY: 'new-openai-key',
      ANTHROPIC_API_KEY: 'new-anthropic-key',
      BASH_ENV: '/tmp/roomote/env.sh',
      ROOMOTE_TASK_ID: 'task-123',
      ROOMOTE_TASK_TYPE: 'standard',
      CLAUDE_APPEND_SYSTEM_PROMPT: 'follow the system instructions',
    });
  });

  it('masks the secrets a reload brings in: the live harness is told and the mask file rewritten after', async () => {
    const order: string[] = [];
    mockGetResolvedRuntimeEnvVars.mockResolvedValue({
      LATE_SERVICE_TOKEN: 'added-mid-task-value',
      APP_NAME: 'not-a-secret',
    });
    mockWriteMaskSecretsFile.mockImplementation(() => order.push('file'));
    const told = vi.fn((_values: string[]) => order.push('harness'));
    onTaskSecretsAdded(told);
    const { caller } = createCaller(createWorkerEnv());

    await caller.commands.reloadDeploymentEnvVars();

    expect(told).toHaveBeenCalledWith(
      expect.arrayContaining(['added-mid-task-value']),
    );
    expect(told.mock.calls[0]![0]).not.toContain('not-a-secret');
    expect(mockWriteMaskSecretsFile).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['harness', 'file']);
  });

  it('masks a new variable before it reaches the shell env, never after', async () => {
    const order: string[] = [];
    mockGetResolvedRuntimeEnvVars.mockResolvedValue({
      LATE_SERVICE_TOKEN: 'added-mid-task-value',
    });
    mockWriteMaskSecretsFile.mockImplementationOnce(() => order.push('file'));
    onTaskSecretsAdded(() => order.push('harness'));
    mockInjectEnvVars.mockImplementationOnce(() => order.push('shell env'));
    const { caller } = createCaller(createWorkerEnv());

    await caller.commands.reloadDeploymentEnvVars();

    expect(order).toEqual(['harness', 'file', 'shell env']);
  });

  it('touches neither the harness secrets nor the mask file when the reload is skipped for a snapshot', async () => {
    await engageCredentialWriteBarrier();
    const told = vi.fn();
    onTaskSecretsAdded(told);
    const { caller } = createCaller(createWorkerEnv());

    await expect(caller.commands.reloadDeploymentEnvVars()).rejects.toThrow();

    expect(told).not.toHaveBeenCalled();
    expect(mockWriteMaskSecretsFile).not.toHaveBeenCalled();
  });

  it('keeps inherited model transport values out of environment shell files on reload', async () => {
    mockGetResolvedRuntimeEnvVars.mockResolvedValue({
      R_MODEL: 'openai/outer-model',
      R_SMALL_MODEL_REASONING_EFFORT: 'low',
    });
    mockFindFirstById.mockResolvedValue({
      id: 1,
      taskId: 'task-123',
      payload: { environmentId: 'environment-1' },
    });
    const workerEnv = createWorkerEnv();
    workerEnv.addUserEnv({ R_VISION_MODEL: 'openai/nested-vision-model' });
    const { caller } = createCaller(workerEnv);

    await caller.commands.reloadDeploymentEnvVars();

    expect(mockInjectEnvVars).toHaveBeenCalledWith(
      expect.objectContaining({ R_MODEL: 'openai/outer-model' }),
      expect.objectContaining({ payload: { environmentId: 'environment-1' } }),
      expect.objectContaining({
        omitInheritedModelRuntimeEnvFromShell: true,
        explicitShellEnvVars: {
          NEXT_PUBLIC_API_BASE: 'https://workspace.example.test',
          R_VISION_MODEL: 'openai/nested-vision-model',
        },
      }),
    );
    expect(workerEnv.getRuntimeEnv()).toMatchObject({
      R_MODEL: 'openai/outer-model',
      R_SMALL_MODEL_REASONING_EFFORT: 'low',
    });
  });

  it('fails when the worker env is unavailable', async () => {
    const { caller } = createCaller(undefined);

    await expect(
      caller.commands.reloadDeploymentEnvVars(),
    ).rejects.toMatchObject({
      message: 'Worker environment is not available for live reload',
    });
  });

  it('rejects without writing env files once the credential write barrier is engaged', async () => {
    await engageCredentialWriteBarrier();

    const { caller } = createCaller(createWorkerEnv());

    await expect(
      caller.commands.reloadDeploymentEnvVars(),
    ).rejects.toMatchObject({
      message:
        'Environment reload is unavailable while the sandbox prepares for a snapshot',
    });
    expect(mockInjectEnvVars).not.toHaveBeenCalled();
  });
});
