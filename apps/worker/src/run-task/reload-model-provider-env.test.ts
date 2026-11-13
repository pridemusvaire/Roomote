const {
  applyDeploymentEnvVarsReloadMock,
  runUnlessBarrierMock,
  waitForBarrierReleaseMock,
} = vi.hoisted(() => ({
  applyDeploymentEnvVarsReloadMock: vi.fn(),
  runUnlessBarrierMock: vi.fn(),
  waitForBarrierReleaseMock: vi.fn(),
}));

vi.mock('../sandbox-server/procedures/reloadDeploymentEnvVars', () => ({
  applyDeploymentEnvVarsReload: applyDeploymentEnvVarsReloadMock,
}));

vi.mock('../lib', () => ({
  runUnlessCredentialWriteBarrier: runUnlessBarrierMock,
  waitForCredentialWriteBarrierRelease: waitForBarrierReleaseMock,
}));

import { applyFreshModelProviderEnv } from './apply-fresh-model-provider-env';
import { createModelProviderEnvReloader } from './reload-model-provider-env';

describe('applyFreshModelProviderEnv', () => {
  it('adds the key of a provider the task now uses', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-a',
      R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY',
    };

    applyFreshModelProviderEnv(env, {
      ANTHROPIC_API_KEY: 'sk-a',
      CURSOR_API_KEY: 'sk-cursor',
      R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY,CURSOR_API_KEY',
    });

    expect(env).toEqual({
      ANTHROPIC_API_KEY: 'sk-a',
      CURSOR_API_KEY: 'sk-cursor',
      R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY,CURSOR_API_KEY',
    });
  });

  it('drops the key of a provider the task no longer uses', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-a',
      CURSOR_API_KEY: 'sk-cursor',
      R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY,CURSOR_API_KEY',
    };

    applyFreshModelProviderEnv(env, {
      ANTHROPIC_API_KEY: 'sk-a',
      R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY',
    });

    expect(env).toEqual({
      ANTHROPIC_API_KEY: 'sk-a',
      R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY',
    });
  });

  it('never takes a key the fresh env does not list, nor the legacy OpenCode auth', () => {
    const env = { HOME: '/home/agent', PATH: '/bin' };

    applyFreshModelProviderEnv(env, {
      HOME: '/elsewhere',
      OPENAI_API_KEY: 'sk-openai-not-listed',
      OPENCODE_AUTH_CONTENT: '{"oauth":true}',
      CURSOR_API_KEY: 'sk-cursor',
      R_MODEL_ENV_KEYS: 'CURSOR_API_KEY,OPENCODE_AUTH_CONTENT',
    });

    expect(env).toEqual({
      HOME: '/home/agent',
      PATH: '/bin',
      CURSOR_API_KEY: 'sk-cursor',
      R_MODEL_ENV_KEYS: 'CURSOR_API_KEY,OPENCODE_AUTH_CONTENT',
    });
  });
});

describe('createModelProviderEnvReloader', () => {
  const logger = { warn: vi.fn() };
  const harness = { id: 'harness' };

  function setup(runtimeEnv: Record<string, string> = {}) {
    const reload = createModelProviderEnvReloader({
      runId: 7,
      workerEnv: { id: 'worker-env' } as never,
      runtimeEnv,
      getHarness: () => harness as never,
      logger: logger as never,
    });

    return { reload, runtimeEnv };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    runUnlessBarrierMock.mockImplementation(async (fn) => await fn());
  });

  it('reloads the deployment env and applies the fresh provider keys to the runtime env', async () => {
    applyDeploymentEnvVarsReloadMock.mockResolvedValue({
      names: [],
      envVars: {
        CURSOR_API_KEY: 'sk-cursor',
        R_MODEL_ENV_KEYS: 'CURSOR_API_KEY',
      },
    });
    const { reload, runtimeEnv } = setup();

    await expect(reload()).resolves.toBe('reloaded');

    expect(applyDeploymentEnvVarsReloadMock).toHaveBeenCalledWith({
      runId: 7,
      workerEnv: { id: 'worker-env' },
      harness,
    });
    expect(runtimeEnv.CURSOR_API_KEY).toBe('sk-cursor');
  });

  it('leaves the runtime env alone while a snapshot holds the credential write barrier', async () => {
    runUnlessBarrierMock.mockResolvedValue(null);
    const { reload, runtimeEnv } = setup({ A: '1' });

    await expect(reload()).resolves.toBe('snapshot');

    expect(waitForBarrierReleaseMock).not.toHaveBeenCalled();
    expect(runtimeEnv).toEqual({ A: '1' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('snapshot'),
    );
  });

  it('logs a failed reload and never throws, so the restart still happens', async () => {
    applyDeploymentEnvVarsReloadMock.mockRejectedValue(new Error('boom'));
    const { reload } = setup();

    await expect(reload()).resolves.toBe('failed');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('waits for the barrier to be released and then reloads, when asked to', async () => {
    runUnlessBarrierMock
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async (fn) => await fn());
    waitForBarrierReleaseMock.mockResolvedValue(true);
    applyDeploymentEnvVarsReloadMock.mockResolvedValue({
      names: [],
      envVars: {
        CURSOR_API_KEY: 'sk-cursor',
        R_MODEL_ENV_KEYS: 'CURSOR_API_KEY',
      },
    });
    const { reload, runtimeEnv } = setup();
    const { signal } = new AbortController();

    await expect(reload({ waitForSnapshot: { signal } })).resolves.toBe(
      'reloaded',
    );

    expect(waitForBarrierReleaseMock).toHaveBeenCalledWith(signal);
    expect(runtimeEnv.CURSOR_API_KEY).toBe('sk-cursor');
  });

  it('stops waiting, and reports the snapshot, when the signal aborts before the barrier is released', async () => {
    runUnlessBarrierMock.mockResolvedValue(null);
    waitForBarrierReleaseMock.mockResolvedValue(false);
    const { reload, runtimeEnv } = setup({ A: '1' });

    await expect(
      reload({ waitForSnapshot: { signal: AbortSignal.abort() } }),
    ).resolves.toBe('snapshot');

    expect(runUnlessBarrierMock).toHaveBeenCalledTimes(1);
    expect(runtimeEnv).toEqual({ A: '1' });
  });
});
