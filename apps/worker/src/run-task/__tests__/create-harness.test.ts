import { PassThrough } from 'node:stream';
import EventEmitter from 'node:events';

const {
  taskRunsStampMilestoneMock,
  getHarnessModelOverrideMock,
  resolveBuiltInMcpServersMock,
  subscribeHarnessCallbacksMock,
  startOpenCodeServerHarnessMock,
  startCursorAcpHarnessMock,
  getTranscriptTailMock,
  recordMessageEnvelopeMock,
  useMaskSecretsFileMock,
} = vi.hoisted(() => ({
  taskRunsStampMilestoneMock: vi.fn().mockResolvedValue(undefined),
  getHarnessModelOverrideMock: vi.fn(),
  resolveBuiltInMcpServersMock: vi.fn((..._args: unknown[]): unknown => []),
  subscribeHarnessCallbacksMock: vi.fn(() =>
    Object.assign(
      vi.fn(async () => {}),
      {
        flushPendingCompletionEvents: vi.fn(async () => {}),
      },
    ),
  ),
  startOpenCodeServerHarnessMock: vi.fn(),
  startCursorAcpHarnessMock: vi.fn(),
  getTranscriptTailMock: vi.fn().mockResolvedValue([]),
  recordMessageEnvelopeMock: vi.fn().mockResolvedValue(undefined),
  useMaskSecretsFileMock: vi.fn(),
}));

vi.mock('@roomote/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roomote/types')>();

  getHarnessModelOverrideMock.mockImplementation(
    actual.getHarnessModelOverride,
  );

  return {
    ...actual,
    getHarnessModelOverride: getHarnessModelOverrideMock,
  };
});

vi.mock('@roomote/sdk/client', () => ({
  sdk: {
    taskRuns: {
      stampMilestone: taskRunsStampMilestoneMock,
      getTranscriptTail: getTranscriptTailMock,
      recordMessageEnvelope: recordMessageEnvelopeMock,
    },
  },
}));

vi.mock('../../sandbox-server', () => ({
  startOpenCodeServerHarness: startOpenCodeServerHarnessMock,
  startCursorAcpHarness: startCursorAcpHarnessMock,
}));

vi.mock('../../commands/setup/setup-mcps', () => ({
  resolveBuiltInMcpServers: resolveBuiltInMcpServersMock,
}));

vi.mock('../../lib/task-secrets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/task-secrets')>()),
  useMaskSecretsFile: useMaskSecretsFileMock,
}));

vi.mock('../subscribe-harness-callbacks', () => ({
  subscribeHarnessCallbacks: subscribeHarnessCallbacksMock,
}));

import {
  recordTaskSecrets,
  resetTaskSecretsForTesting,
} from '../../lib/task-secrets';
import { createHarness } from '../create-harness';
import { applyFreshModelProviderEnv } from '../apply-fresh-model-provider-env';

function createPendingSubprocess(stdout = new PassThrough()) {
  return Object.assign(new Promise<never>(() => undefined), {
    stdout,
    kill: vi.fn(),
  });
}

function createLogger() {
  return {
    runId: 1,
    filePath: '/tmp/test.log',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function createConnectedHarness() {
  return new (class extends EventEmitter {
    subscribe() {
      return () => {};
    }
    subscribeRuntimeOutput() {
      return () => {};
    }
    subscribeRuntimePersistedEnvelope() {
      return () => {};
    }
    subscribeRuntimeTurnCompleted() {
      return () => {};
    }
    subscribeTaskMessageEnvelope() {
      return () => {};
    }
    subscribeTurnCompleted() {
      return () => {};
    }
    get supportsNativeTurnSteering() {
      return false;
    }
    getPendingUserInputRequests() {
      return [];
    }
    getQueuedMessages() {
      return [];
    }
    getQueuedMessageSnapshots() {
      return [];
    }
    get isConnected() {
      return true;
    }
    sendCommand() {
      return true;
    }
    dispose() {}
  })();
}

describe('createHarness', () => {
  beforeEach(() => {
    taskRunsStampMilestoneMock.mockReset();
    taskRunsStampMilestoneMock.mockResolvedValue(undefined);
    getHarnessModelOverrideMock.mockClear();
    resolveBuiltInMcpServersMock.mockReset();
    resolveBuiltInMcpServersMock.mockReturnValue([]);
    subscribeHarnessCallbacksMock.mockClear();
    startOpenCodeServerHarnessMock.mockReset();
    startCursorAcpHarnessMock.mockReset();
    getTranscriptTailMock.mockReset().mockResolvedValue([]);
    recordMessageEnvelopeMock.mockReset().mockResolvedValue(undefined);
    useMaskSecretsFileMock.mockReset();
    resetTaskSecretsForTesting();
  });

  it('strips source-control tokens from the long-lived harness env while keeping BASH_ENV', async () => {
    const subprocess = createPendingSubprocess();

    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess,
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        GH_TOKEN: 'ghs_stale',
        GITLAB_TOKEN: 'glpat_stale',
        GITEA_TOKEN: 'gitea_stale',
        ADO_TOKEN: 'ado_stale',
        BASH_ENV: '/home/testuser/.roomote/env.sh',
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: 'session-1',
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: { id: 1, taskId: 'task-1' } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeEnv: {
          BASH_ENV: '/home/testuser/.roomote/env.sh',
          OPENAI_API_KEY: 'sk-test-openai',
        },
      }),
    );
  });

  it('passes the reconnectable session id through to the OpenCode harness', async () => {
    const subprocess = createPendingSubprocess();

    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess,
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: 'thread-resume-123',
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: { id: 1, taskId: 'task-1' } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSessionId: 'thread-resume-123',
      }),
    );
  });

  it('passes an OpenCode model override to the OpenCode harness', async () => {
    const subprocess = createPendingSubprocess();

    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess,
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: undefined,
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: {
        id: 4,
        taskId: 'task-4',
        payload: {
          harnessModelOverrides: {
            'opencode-server': 'provider-id/model-id',
          },
          reasoningEffort: 'high',
        },
      } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: 'provider-id/model-id',
        reasoningEffortOverride: 'high',
      }),
    );
    expect(getHarnessModelOverrideMock).toHaveBeenCalledTimes(1);
  });

  it('builds subagent fallbacks against the effective coding model when roles inherit it', async () => {
    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess: createPendingSubprocess(),
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        R_MODEL: 'openai/gpt-coding',
        R_VISION_MODEL_FALLBACK: 'anthropic/vision-fallback',
        R_VISION_MODEL_FALLBACK_REASONING_EFFORT: 'low',
        R_EXPLORE_MODEL: 'openai/explore',
        R_EXPLORE_MODEL_FALLBACK: 'anthropic/explore-fallback',
        R_PLANNING_MODEL_FALLBACK: 'openai/gpt-coding',
      },
      harnessSessionId: undefined,
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: { id: 6, taskId: 'task-6', payload: {} } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    const startOptions = startOpenCodeServerHarnessMock.mock.calls[0]?.[0] as {
      agentFallbacks?: Record<string, unknown>;
    };
    expect(startOptions.agentFallbacks).toEqual({
      visual: {
        role: 'vision',
        activeModelId: 'openai/gpt-coding',
        fallbackModel: 'anthropic/vision-fallback',
        fallbackReasoningEffort: 'low',
      },
      judge: {
        role: 'vision',
        activeModelId: 'openai/gpt-coding',
        fallbackModel: 'anthropic/vision-fallback',
        fallbackReasoningEffort: 'low',
      },
      explore: {
        role: 'explore',
        activeModelId: 'openai/explore',
        fallbackModel: 'anthropic/explore-fallback',
      },
    });
  });

  it('uses the per-task model override as the inherited subagent model', async () => {
    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess: createPendingSubprocess(),
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        R_MODEL: 'openai/gpt-coding',
        R_PLANNING_MODEL_FALLBACK: 'anthropic/advisor-fallback',
      },
      harnessSessionId: undefined,
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: {
        id: 7,
        taskId: 'task-7',
        payload: {
          harnessModelOverrides: {
            'opencode-server': 'provider-id/model-id',
          },
        },
      } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    const startOptions = startOpenCodeServerHarnessMock.mock.calls[0]?.[0] as {
      agentFallbacks?: Record<string, unknown>;
    };
    expect(startOptions.agentFallbacks).toEqual({
      advisor: {
        role: 'planning',
        activeModelId: 'provider-id/model-id',
        fallbackModel: 'anthropic/advisor-fallback',
      },
    });
  });

  it('overlays per-task model role overrides onto the spawn env and re-reads them on respawn', async () => {
    const firstHarness = createConnectedHarness();
    const secondHarness = createConnectedHarness();

    startOpenCodeServerHarnessMock
      .mockResolvedValueOnce({
        harness: firstHarness,
        subprocess: createPendingSubprocess(),
      })
      .mockResolvedValueOnce({
        harness: secondHarness,
        subprocess: createPendingSubprocess(),
      });

    const taskRun = {
      id: 7,
      taskId: 'task-7',
      payload: {
        modelRoleOverrides: {
          planning: {
            model: 'openrouter/test/planner',
            reasoningEffort: 'max',
          },
          explore: { reasoningEffort: 'low' },
        },
      },
    };

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: undefined,
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: taskRun as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeEnv: {
          OPENAI_API_KEY: 'sk-test-openai',
          R_PLANNING_MODEL: 'openrouter/test/planner',
          R_PLANNING_MODEL_REASONING_EFFORT: 'max',
          R_EXPLORE_MODEL_REASONING_EFFORT: 'low',
        },
      }),
    );

    // A live model-settings update mutates the shared payload and restarts
    // the harness; the respawn must pick up the current overrides.
    taskRun.payload.modelRoleOverrides = {
      planning: { model: 'openrouter/test/other-planner' },
    } as never;
    firstHarness.emit('disconnected');

    await vi.waitFor(() =>
      expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(2),
    );
    expect(startOpenCodeServerHarnessMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeEnv: {
          OPENAI_API_KEY: 'sk-test-openai',
          R_PLANNING_MODEL: 'openrouter/test/other-planner',
        },
      }),
    );
  });

  it('starts opencode-server with its model override and generated prompt inputs', async () => {
    const subprocess = createPendingSubprocess();

    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess,
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        GH_TOKEN: 'ghs_stale',
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: 'ses_resume',
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: {
        id: 6,
        taskId: 'task-6',
        payload: {
          harnessModelOverrides: {
            'opencode-server': 'provider-id/model-id',
          },
        },
      } as never,
      developerInstructionsContent: 'developer instructions',
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/tmp/workspace',
        runtimeEnv: {
          OPENAI_API_KEY: 'sk-test-openai',
        },
        initialSessionId: 'ses_resume',
        modelOverride: 'provider-id/model-id',
        developerInstructionsContent: 'developer instructions',
      }),
    );
    expect(getHarnessModelOverrideMock).toHaveBeenCalledWith(
      {
        'opencode-server': 'provider-id/model-id',
      },
      'opencode-server',
    );
  });

  it('passes the queued actor-scope hook through to the OpenCode harness', async () => {
    const subprocess = createPendingSubprocess();
    const beforeQueuedPrompt = vi.fn();

    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess,
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: undefined,
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: { id: 5, taskId: 'task-5' } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
      prepareQueuedPromptActorScope: beforeQueuedPrompt,
    });

    const startOptions = startOpenCodeServerHarnessMock.mock.calls[0]?.[0] as
      | {
          beforeQueuedPrompt?: (input: {
            userId?: string;
            clientMessageId?: string;
            kind: 'queuedPrompt' | 'userInputAnswer';
          }) => Promise<unknown>;
        }
      | undefined;

    expect(startOptions?.beforeQueuedPrompt).toBeTypeOf('function');
    await expect(
      startOptions?.beforeQueuedPrompt?.({
        userId: 'user-2',
        clientMessageId: 'slack:1710000000.456',
        kind: 'queuedPrompt',
      }),
    ).resolves.toBeUndefined();
    expect(beforeQueuedPrompt).toHaveBeenCalledWith('user-2', {
      kind: 'queuedPrompt',
      clientMessageId: 'slack:1710000000.456',
    });
  });

  it('stamps harnessStartedAt once the harness subprocess is alive', async () => {
    const subprocess = createPendingSubprocess();

    startOpenCodeServerHarnessMock.mockResolvedValue({
      harness: createConnectedHarness(),
      subprocess,
    });

    await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: 'session-1',
      cancelSignal: new AbortController().signal,
      integrations: {} as never,
      mcpTaskEnv: {},
      taskRun: { id: 77, taskId: 'task-77' } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(taskRunsStampMilestoneMock).toHaveBeenCalledWith({
      runId: 77,
      field: 'harnessStartedAt',
    });
  });

  it('starts OpenCode with the resolved MCP map and remounts with refreshed MCPs on reconnect', async () => {
    const initialHarness = createConnectedHarness();
    const reconnectedHarness = createConnectedHarness();
    const initialSubprocess = createPendingSubprocess(new PassThrough());
    const reconnectedSubprocess = createPendingSubprocess(new PassThrough());
    const integrations = {
      userMcpServers: {
        roomote: {
          url: 'https://actor-a.example/mcp',
        },
      },
    };

    startOpenCodeServerHarnessMock
      .mockResolvedValueOnce({
        harness: initialHarness,
        subprocess: initialSubprocess,
      })
      .mockResolvedValueOnce({
        harness: reconnectedHarness,
        subprocess: reconnectedSubprocess,
      });
    resolveBuiltInMcpServersMock.mockImplementation(((...args: unknown[]) => {
      const currentIntegrations = args[1] as typeof integrations;
      return currentIntegrations.userMcpServers ?? ({} as never);
    }) as never);

    const result = await createHarness({
      harnessType: 'opencode-server',
      workspacePath: '/tmp/workspace',
      runtimeEnv: {
        GH_TOKEN: 'ghs_stale',
        BASH_ENV: '/home/testuser/.roomote/env.sh',
        OPENAI_API_KEY: 'sk-test-openai',
      },
      harnessSessionId: undefined,
      cancelSignal: new AbortController().signal,
      integrations: integrations as never,
      mcpTaskEnv: {},
      taskRun: { id: 1, taskId: 'task-1' } as never,
      callbacks: {} as never,
      context: {} as never,
      logger: createLogger(),
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspacePath: '/tmp/workspace',
        runtimeEnv: {
          BASH_ENV: '/home/testuser/.roomote/env.sh',
          OPENAI_API_KEY: 'sk-test-openai',
        },
        cancelSignal: expect.any(AbortSignal),
        logger: expect.any(Object),
        mcpServers: {
          roomote: {
            url: 'https://actor-a.example/mcp',
          },
        },
        initialSessionId: undefined,
      }),
    );
    expect(getHarnessModelOverrideMock).not.toHaveBeenCalled();
    expect(result.harness.requestReconnect).toBeTypeOf('function');
    expect(taskRunsStampMilestoneMock).toHaveBeenCalledWith({
      runId: 1,
      field: 'harnessStartedAt',
    });
    expect(subscribeHarnessCallbacksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: result.harness,
        taskRun: { id: 1, taskId: 'task-1' },
      }),
    );
    expect(result.getSubprocess()).toBe(initialSubprocess);
    expect(result.flushPendingCompletionEvents).toBeTypeOf('function');

    integrations.userMcpServers = {
      roomote: {
        url: 'https://actor-b.example/mcp',
      },
    };

    await result.harness.requestReconnect?.({
      reason: 'actor-scoped MCP refresh for actor-b',
    });

    expect(startOpenCodeServerHarnessMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspacePath: '/tmp/workspace',
        runtimeEnv: {
          BASH_ENV: '/home/testuser/.roomote/env.sh',
          OPENAI_API_KEY: 'sk-test-openai',
        },
        cancelSignal: expect.any(AbortSignal),
        logger: expect.any(Object),
        mcpServers: {
          roomote: {
            url: 'https://actor-b.example/mcp',
          },
        },
        initialSessionId: undefined,
      }),
    );
    expect(result.getSubprocess()).toBe(reconnectedSubprocess);
  });

  describe('engine routing by coding model', () => {
    const CURSOR_SESSION = '3f2a9c1e-7b4d-4e8a-9f61-0c5d2a8b7e14';

    const spawned = () => ({
      harness: createConnectedHarness(),
      subprocess: createPendingSubprocess(),
    });

    function launch(input: {
      runtimeEnv?: Record<string, string>;
      payload?: Record<string, unknown>;
      payloadKind?: string;
      harnessSessionId?: string;
      developerInstructionsContent?: string;
    }) {
      const taskRun = {
        id: 9,
        taskId: 'task-9',
        payload: input.payload ?? {},
        ...(input.payloadKind ? { payloadKind: input.payloadKind } : {}),
      };

      return {
        taskRun,
        promise: createHarness({
          harnessType: 'opencode-server',
          workspacePath: '/tmp/workspace',
          runtimeEnv: { CURSOR_API_KEY: 'cursor-key', ...input.runtimeEnv },
          harnessSessionId: input.harnessSessionId,
          cancelSignal: new AbortController().signal,
          integrations: {} as never,
          mcpTaskEnv: {},
          taskRun: taskRun as never,
          developerInstructionsContent: input.developerInstructionsContent,
          callbacks: {} as never,
          context: {} as never,
          logger: createLogger(),
        }),
      };
    }

    it('runs a cursor coding model on the Cursor agent, never on OpenCode', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());

      await launch({
        runtimeEnv: {
          R_MODEL: 'cursor/composer-2.5',
          R_MODEL_FALLBACK: 'openai/gpt-5',
          R_MODEL_FALLBACK_REASONING_EFFORT: 'high',
          R_VISION_MODEL_FALLBACK: 'anthropic/vision-fallback',
        },
        developerInstructionsContent: 'developer instructions',
      }).promise;

      expect(startOpenCodeServerHarnessMock).not.toHaveBeenCalled();
      expect(startCursorAcpHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: 'composer-2.5',
          developerInstructionsContent: 'developer instructions',
          fallbackModel: 'openai/gpt-5',
          fallbackReasoningEffort: 'high',
          fallbackRole: 'coding',
          activeModelId: 'cursor/composer-2.5',
          runtimeEnv: expect.objectContaining({ CURSOR_API_KEY: 'cursor-key' }),
        }),
      );
      // OpenCode-only options stay out of the Cursor harness.
      expect(startCursorAcpHarnessMock.mock.calls[0]?.[0]).not.toHaveProperty(
        'agentFallbacks',
      );
    });

    it('hands the Cursor harness the secret values of the whole task, tokens the spawn env drops included', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());

      await launch({
        runtimeEnv: {
          R_MODEL: 'cursor/composer-2.5',
          GITLAB_TOKEN: 'glpat-source-control-token',
          OPENAI_API_KEY: 'sk-test-openai-key',
          APP_NAME: 'roomote-app',
        },
      }).promise;

      const { secretValues } = startCursorAcpHarnessMock.mock.calls[0]![0];
      expect(secretValues).toEqual(
        expect.arrayContaining([
          'cursor-key',
          'glpat-source-control-token',
          'sk-test-openai-key',
        ]),
      );
      expect(secretValues).not.toContain('roomote-app');
    });

    it('gives a respawn the secrets that reached the task after the first start', async () => {
      startCursorAcpHarnessMock.mockImplementation(async () => spawned());
      const { promise } = launch({
        runtimeEnv: { R_MODEL: 'cursor/composer-2.5' },
      });
      const { harness } = await promise;

      recordTaskSecrets({ LATE_API_KEY: 'added-mid-task-value' });
      await harness.requestReconnect!({ reason: 'test' });

      expect(
        startCursorAcpHarnessMock.mock.calls[0]![0].secretValues,
      ).not.toContain('added-mid-task-value');
      expect(
        startCursorAcpHarnessMock.mock.calls[1]![0].secretValues,
      ).toContain('added-mid-task-value');
    });

    it('tells the live Cursor harness of a secret that reaches the task later, until the task is unsubscribed', async () => {
      const live = Object.assign(createConnectedHarness(), {
        addSecretValues: vi.fn(),
      });
      startCursorAcpHarnessMock.mockResolvedValue({
        harness: live,
        subprocess: createPendingSubprocess(),
      });
      const { harness, unsubscribe } = await launch({
        runtimeEnv: { R_MODEL: 'cursor/composer-2.5' },
      }).promise;
      expect(harness).toBeDefined();

      recordTaskSecrets({ LATE_API_KEY: 'added-mid-task-value' });

      expect(live.addSecretValues).toHaveBeenCalledWith(
        expect.arrayContaining(['added-mid-task-value']),
      );

      await unsubscribe();
      live.addSecretValues.mockClear();
      recordTaskSecrets({ LATER_API_KEY: 'added-after-unsubscribe' });

      expect(live.addSecretValues).not.toHaveBeenCalled();
    });

    it('masks Roomote tool inputs on a Cursor task only: the file is written and the MCP server pointed at it', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());

      await launch({ runtimeEnv: { R_MODEL: 'cursor/composer-2.5' } }).promise;

      expect(useMaskSecretsFileMock).toHaveBeenCalledWith(true);
      expect(resolveBuiltInMcpServersMock.mock.calls[0]![5]).toEqual({
        maskSecretValues: true,
      });
    });

    it('leaves an OpenCode task unmasked: no file, and an MCP server that is not pointed at one', async () => {
      startOpenCodeServerHarnessMock.mockResolvedValue(spawned());

      await launch({ runtimeEnv: { R_MODEL: 'openai/gpt-5' } }).promise;

      expect(useMaskSecretsFileMock).toHaveBeenCalledWith(false);
      expect(useMaskSecretsFileMock).not.toHaveBeenCalledWith(true);
      expect(resolveBuiltInMcpServersMock.mock.calls[0]![5]).toEqual({
        maskSecretValues: false,
      });
    });

    it('names the Cursor model that is running, not the code review role model, as the fallback source', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());

      await launch({
        payloadKind: 'github_pr_review_sync',
        runtimeEnv: {
          R_MODEL: 'cursor/composer-2.5',
          R_CODE_REVIEW_MODEL: 'anthropic/claude-sonnet-5-5',
          R_CODE_REVIEW_MODEL_FALLBACK: 'openai/gpt-5',
        },
      }).promise;

      expect(startCursorAcpHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackRole: 'codeReview',
          fallbackModel: 'openai/gpt-5',
          activeModelId: 'cursor/composer-2.5',
        }),
      );
    });

    it('remembers requested fallbacks across respawns of the Cursor harness', async () => {
      const first = createConnectedHarness();
      startCursorAcpHarnessMock
        .mockResolvedValueOnce({
          harness: first,
          subprocess: createPendingSubprocess(),
        })
        .mockResolvedValue(spawned());

      await launch({
        runtimeEnv: {
          R_MODEL: 'cursor/composer-2.5',
          R_MODEL_FALLBACK: 'openai/gpt-5',
        },
      }).promise;
      const attempts = startCursorAcpHarnessMock.mock.calls[0]![0]
        .fallbackAttempts as Set<string>;
      attempts.add('coding:cursor/composer-2.5');
      first.emit('disconnected');

      await vi.waitFor(() =>
        expect(startCursorAcpHarnessMock).toHaveBeenCalledTimes(2),
      );
      expect(startCursorAcpHarnessMock.mock.calls[1]![0].fallbackAttempts).toBe(
        attempts,
      );
    });

    it('rebuilds a lost Cursor session from the transcript and the prompt about to run', async () => {
      getTranscriptTailMock.mockResolvedValue([
        { role: 'user', text: 'first ask' },
        { role: 'assistant', text: 'did the first part' },
      ]);
      startCursorAcpHarnessMock.mockResolvedValue(spawned());

      await launch({ runtimeEnv: { R_MODEL: 'cursor/composer-2.5' } }).promise;
      const { restoreContext } = startCursorAcpHarnessMock.mock.calls[0]![0];
      const instructions = await restoreContext({
        text: 'now do the next thing',
      });

      expect(getTranscriptTailMock).toHaveBeenCalledWith({ runId: 9 });
      expect(instructions).toContain('- User: first ask');
      expect(instructions).toContain(
        'latest request (verbatim)\nnow do the next thing',
      );

      getTranscriptTailMock.mockRejectedValue(new Error('boom'));
      await expect(restoreContext({ text: 'x' })).resolves.toBeUndefined();
    });

    it('routes on a per-task model override', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());

      await launch({
        payload: {
          harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
        },
      }).promise;

      expect(startCursorAcpHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({ modelOverride: 'composer-2.5' }),
      );
    });

    it('switches engines on respawn after a model fallback, starting fresh', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());
      startOpenCodeServerHarnessMock.mockResolvedValue(spawned());
      const cursorHarness = createConnectedHarness();
      startCursorAcpHarnessMock.mockResolvedValue({
        harness: cursorHarness,
        subprocess: createPendingSubprocess(),
      });

      const { taskRun, promise } = launch({
        payload: {
          harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
        },
        harnessSessionId: CURSOR_SESSION,
      });
      await promise;
      expect(startCursorAcpHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({ initialSessionId: CURSOR_SESSION }),
      );

      // What run-task does on a plan-limit fallback: mutate the payload, then
      // reconnect.
      taskRun.payload = {
        harnessModelOverrides: { 'opencode-server': 'openai/gpt-5' },
      };
      cursorHarness.emit('disconnected');

      await vi.waitFor(() =>
        expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(1),
      );
      expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: 'openai/gpt-5',
          initialSessionId: undefined,
        }),
      );
    });

    it("respawns on a model it was switched to with that provider's key, and without the key of the one it left", async () => {
      const first = createConnectedHarness();
      startOpenCodeServerHarnessMock.mockResolvedValueOnce({
        harness: first,
        subprocess: createPendingSubprocess(),
      });
      startCursorAcpHarnessMock.mockResolvedValue(spawned());
      // No Cursor key at launch: the task started on an OpenCode model.
      const runtimeEnv: Record<string, string> = {
        ANTHROPIC_API_KEY: 'sk-anthropic',
        R_MODEL_ENV_KEYS: 'ANTHROPIC_API_KEY',
      };
      const taskRun = {
        id: 9,
        taskId: 'task-9',
        payload: {
          harnessModelOverrides: { 'opencode-server': 'anthropic/claude-x' },
        },
      };

      await createHarness({
        harnessType: 'opencode-server',
        workspacePath: '/tmp/workspace',
        runtimeEnv,
        harnessSessionId: undefined,
        cancelSignal: new AbortController().signal,
        integrations: {} as never,
        mcpTaskEnv: {},
        taskRun: taskRun as never,
        callbacks: {} as never,
        context: {} as never,
        logger: createLogger(),
      });
      expect(
        startOpenCodeServerHarnessMock.mock.calls[0]![0].runtimeEnv,
      ).toEqual(expect.objectContaining({ ANTHROPIC_API_KEY: 'sk-anthropic' }));

      // What run-task does for a model switch: persist the payload, refresh
      // the provider env in place, then restart.
      taskRun.payload = {
        harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
      };
      applyFreshModelProviderEnv(runtimeEnv, {
        CURSOR_API_KEY: 'sk-cursor',
        R_MODEL_ENV_KEYS: 'CURSOR_API_KEY',
      });
      first.emit('disconnected');

      await vi.waitFor(() =>
        expect(startCursorAcpHarnessMock).toHaveBeenCalledTimes(1),
      );
      const spawnEnv = startCursorAcpHarnessMock.mock.calls[0]![0].runtimeEnv;
      expect(spawnEnv.CURSOR_API_KEY).toBe('sk-cursor');
      expect(spawnEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    describe('carrying the conversation across an engine switch', () => {
      const turns = [
        { role: 'user', text: 'first ask' },
        { role: 'assistant', text: 'did the first part' },
        { role: 'user', text: 'now finish the migration' },
      ];

      async function switchEngines(input: {
        from: { model: string; session: string };
        to: string;
      }) {
        getTranscriptTailMock.mockResolvedValue(turns);
        const first = createConnectedHarness();
        startCursorAcpHarnessMock.mockResolvedValue(spawned());
        startOpenCodeServerHarnessMock.mockResolvedValue(spawned());
        (input.from.model.startsWith('cursor/')
          ? startCursorAcpHarnessMock
          : startOpenCodeServerHarnessMock
        ).mockResolvedValueOnce({
          harness: first,
          subprocess: createPendingSubprocess(),
        });
        const { taskRun, promise } = launch({
          payload: {
            harnessModelOverrides: { 'opencode-server': input.from.model },
          },
          harnessSessionId: input.from.session,
          developerInstructionsContent: 'developer instructions',
        });
        await promise;
        taskRun.payload = {
          harnessModelOverrides: { 'opencode-server': input.to },
        };
        first.emit('disconnected');
      }

      it('Cursor to OpenCode: hands the transcript to the fresh session and says so', async () => {
        await switchEngines({
          from: { model: 'cursor/composer-2.5', session: CURSOR_SESSION },
          to: 'openai/gpt-5',
        });

        await vi.waitFor(() =>
          expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(1),
        );
        const options = startOpenCodeServerHarnessMock.mock.calls[0]![0];
        expect(options.initialSessionId).toBeUndefined();
        // The handoff is part of the new session's own history (first
        // prompt), not per-spawn system instructions: those are rewritten on
        // every respawn and would lose it, and would label an old message as
        // the latest request on every later turn.
        expect(options.developerInstructionsContent).toBe(
          'developer instructions',
        );
        expect(options.handoffContext).toContain('running on Cursor');
        expect(options.handoffContext).toContain('now finish the migration');
        expect(recordMessageEnvelopeMock).toHaveBeenCalledTimes(1);
        expect(
          JSON.stringify(recordMessageEnvelopeMock.mock.calls[0]),
        ).toContain('switched from Cursor to OpenCode');
      });

      it('OpenCode to Cursor: hands the transcript to the fresh session and says so', async () => {
        await switchEngines({
          from: { model: 'openai/gpt-5', session: 'ses_opencode_made_this' },
          to: 'cursor/composer-2.5',
        });

        await vi.waitFor(() =>
          expect(startCursorAcpHarnessMock).toHaveBeenCalledTimes(1),
        );
        const options = startCursorAcpHarnessMock.mock.calls[0]![0];
        expect(options.initialSessionId).toBeUndefined();
        expect(options.developerInstructionsContent).toContain(
          'running on OpenCode',
        );
        expect(options.developerInstructionsContent).toContain(
          'now finish the migration',
        );
        expect(
          JSON.stringify(recordMessageEnvelopeMock.mock.calls[0]),
        ).toContain('switched from OpenCode to Cursor');
      });

      it('Cursor to OpenCode: hands the transcript over although Cursor never stored a session', async () => {
        getTranscriptTailMock.mockResolvedValue(turns);
        const first = createConnectedHarness();
        startCursorAcpHarnessMock.mockResolvedValue({
          harness: first,
          subprocess: createPendingSubprocess(),
        });
        startOpenCodeServerHarnessMock.mockResolvedValue(spawned());
        // The Cursor session could not be created, so no id was ever stored.
        const { taskRun, promise } = launch({
          payload: {
            harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
          },
          harnessSessionId: undefined,
        });
        await promise;
        taskRun.payload = {
          harnessModelOverrides: { 'opencode-server': 'openai/gpt-5' },
        };
        first.emit('disconnected');

        await vi.waitFor(() =>
          expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(1),
        );
        const options = startOpenCodeServerHarnessMock.mock.calls[0]![0];
        expect(options.handoffContext).toContain('running on Cursor');
        expect(options.handoffContext).toContain('now finish the migration');
        expect(
          JSON.stringify(recordMessageEnvelopeMock.mock.calls[0]),
        ).toContain('switched from Cursor to OpenCode');
        // No session to file the note under: it carries no session id at all,
        // not an empty one.
        expect(
          JSON.stringify(recordMessageEnvelopeMock.mock.calls[0]),
        ).not.toContain('"sessionId"');
      });

      it('hands nothing over when a respawn stays on the same engine without a session', async () => {
        getTranscriptTailMock.mockResolvedValue(turns);
        const first = createConnectedHarness();
        startOpenCodeServerHarnessMock
          .mockResolvedValueOnce({
            harness: first,
            subprocess: createPendingSubprocess(),
          })
          .mockResolvedValue(spawned());
        const { promise } = launch({
          payload: {
            harnessModelOverrides: { 'opencode-server': 'openai/gpt-5' },
          },
          harnessSessionId: undefined,
        });
        await promise;
        first.emit('disconnected');

        await vi.waitFor(() =>
          expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(2),
        );
        expect(
          startOpenCodeServerHarnessMock.mock.calls[1]![0].handoffContext,
        ).toBeUndefined();
        expect(getTranscriptTailMock).not.toHaveBeenCalled();
      });

      it('makes a replayed prompt the current request when the switch replays one', async () => {
        getTranscriptTailMock.mockResolvedValue(turns);
        const first = createConnectedHarness();
        startCursorAcpHarnessMock.mockResolvedValue({
          harness: first,
          subprocess: createPendingSubprocess(),
        });
        startOpenCodeServerHarnessMock.mockResolvedValue(spawned());
        const { taskRun, promise } = launch({
          payload: {
            harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
          },
          harnessSessionId: CURSOR_SESSION,
        });
        await promise;

        // What run-task does after a plan limit on a prompt the model never
        // saw: the harness announces the replay, the payload changes, and the
        // worker reconnects.
        first.emit('modelFallbackRequested', {
          role: 'coding',
          fromModelId: 'cursor/composer-2.5',
          toModelId: 'openai/gpt-5',
          toReasoningEffort: null,
          errorSummary: 'limit',
          trigger: 'immediate',
          replayPrompt: { text: 'the prompt that never ran' },
        });
        taskRun.payload = {
          harnessModelOverrides: { 'opencode-server': 'openai/gpt-5' },
        };
        first.emit('disconnected');

        await vi.waitFor(() =>
          expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(1),
        );
        const instructions =
          startOpenCodeServerHarnessMock.mock.calls[0]![0].handoffContext;
        expect(instructions).toContain(
          'latest request (verbatim)\nthe prompt that never ran',
        );
        expect(instructions).toContain('- User: now finish the migration');
      });

      it('still switches when the transcript cannot be read', async () => {
        getTranscriptTailMock.mockRejectedValue(new Error('boom'));
        recordMessageEnvelopeMock.mockRejectedValue(new Error('boom'));
        const first = createConnectedHarness();
        startCursorAcpHarnessMock.mockResolvedValue({
          harness: first,
          subprocess: createPendingSubprocess(),
        });
        startOpenCodeServerHarnessMock.mockResolvedValue(spawned());
        const { taskRun, promise } = launch({
          payload: {
            harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
          },
          harnessSessionId: CURSOR_SESSION,
          developerInstructionsContent: 'developer instructions',
        });
        await promise;
        taskRun.payload = {
          harnessModelOverrides: { 'opencode-server': 'openai/gpt-5' },
        };
        first.emit('disconnected');

        await vi.waitFor(() =>
          expect(startOpenCodeServerHarnessMock).toHaveBeenCalledTimes(1),
        );
        const options = startOpenCodeServerHarnessMock.mock.calls[0]![0];
        expect(options.developerInstructionsContent).toBe(
          'developer instructions',
        );
        expect(options.handoffContext).toBeUndefined();
      });

      it('does not hand off again when OpenCode resumes its own session', async () => {
        getTranscriptTailMock.mockResolvedValue(turns);
        startOpenCodeServerHarnessMock.mockResolvedValue(spawned());

        await launch({
          runtimeEnv: { R_MODEL: 'openai/gpt-5' },
          harnessSessionId: 'ses_opencode_made_this',
          developerInstructionsContent: 'developer instructions',
        }).promise;

        const options = startOpenCodeServerHarnessMock.mock.calls[0]![0];
        expect(options.initialSessionId).toBe('ses_opencode_made_this');
        expect(options.handoffContext).toBeUndefined();
        expect(options.developerInstructionsContent).toBe(
          'developer instructions',
        );
        expect(getTranscriptTailMock).not.toHaveBeenCalled();
      });
    });

    it('does not resume an OpenCode session on the Cursor agent, or the reverse', async () => {
      startCursorAcpHarnessMock.mockResolvedValue(spawned());
      startOpenCodeServerHarnessMock.mockResolvedValue(spawned());

      await launch({
        runtimeEnv: { R_MODEL: 'cursor/composer-2.5' },
        harnessSessionId: 'ses_opencode_made_this',
      }).promise;
      await launch({
        runtimeEnv: { R_MODEL: 'openai/gpt-5' },
        harnessSessionId: CURSOR_SESSION,
      }).promise;

      expect(startCursorAcpHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({ initialSessionId: undefined }),
      );
      expect(startOpenCodeServerHarnessMock).toHaveBeenCalledWith(
        expect.objectContaining({ initialSessionId: undefined }),
      );
    });

    it('fails the launch with the Cursor key error instead of retrying', async () => {
      const { HarnessStartError } =
        await import('../../sandbox-server/lib/harness-start-error');
      startCursorAcpHarnessMock.mockRejectedValue(
        new HarnessStartError('CURSOR_API_KEY is not set.', {
          retryable: false,
        }),
      );

      await expect(
        launch({
          runtimeEnv: { R_MODEL: 'cursor/composer-2.5', CURSOR_API_KEY: '' },
        }).promise,
      ).rejects.toThrow('CURSOR_API_KEY is not set.');
      expect(startCursorAcpHarnessMock).toHaveBeenCalledTimes(1);
      expect(startOpenCodeServerHarnessMock).not.toHaveBeenCalled();
    });
  });
});
