const { mockResolveEffectiveDeploymentEnvVars, mockValidateNonTaskInference } =
  vi.hoisted(() => ({
    mockResolveEffectiveDeploymentEnvVars: vi.fn(),
    mockValidateNonTaskInference: vi.fn(),
  }));

vi.mock('@roomote/db/server', () => ({
  resolveEffectiveDeploymentEnvVars: mockResolveEffectiveDeploymentEnvVars,
}));

vi.mock('@roomote/cloud-agents/server', () => ({
  validateNonTaskInference: mockValidateNonTaskInference,
}));

import { getSetupModelProvider } from '@roomote/types';

import {
  assertInferenceProviderConnection,
  InferenceProviderValidationError,
  validateSetupModelProviderCredentials,
} from './provider-validation';

describe('assertInferenceProviderConnection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
    mockResolveEffectiveDeploymentEnvVars.mockResolvedValue({
      ANTHROPIC_API_KEY: 'saved-key',
      AWS_REGION: 'us-east-1',
    });
    mockValidateNonTaskInference.mockResolvedValue({
      success: true,
      checkedAt: '2026-08-13T12:00:00.000Z',
      latencyMs: 25,
      model: 'anthropic/claude-sonnet-5',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('overlays submitted credentials without persisting them first', async () => {
    await assertInferenceProviderConnection({
      providerLabel: 'Anthropic',
      providerEnvVarNames: ['ANTHROPIC_API_KEY'],
      modelId: 'anthropic/claude-sonnet-5',
      credentialValues: [{ name: 'ANTHROPIC_API_KEY', value: 'candidate-key' }],
    });

    expect(mockValidateNonTaskInference).toHaveBeenCalledWith({
      model: 'anthropic/claude-sonnet-5',
      runtimeEnv: {
        ANTHROPIC_API_KEY: 'candidate-key',
      },
    });
  });

  it('still validates the submitted credential when a runtime env var shadows it', async () => {
    process.env.ANTHROPIC_API_KEY = 'runtime-key';

    await assertInferenceProviderConnection({
      providerLabel: 'Anthropic',
      providerEnvVarNames: ['ANTHROPIC_API_KEY'],
      modelId: 'anthropic/claude-sonnet-5',
      credentialValues: [{ name: 'ANTHROPIC_API_KEY', value: 'candidate-key' }],
    });

    // The submitted value is what the save persists, so it is the value
    // exercised even though this process would resolve the runtime key.
    expect(mockValidateNonTaskInference).toHaveBeenCalledWith({
      model: 'anthropic/claude-sonnet-5',
      runtimeEnv: { ANTHROPIC_API_KEY: 'candidate-key' },
    });
  });

  it('does not block the save on failures that do not indict the credentials', async () => {
    mockValidateNonTaskInference.mockResolvedValue({
      success: false,
      checkedAt: '2026-08-13T12:00:00.000Z',
      latencyMs: 25,
      message: 'The selected model is unavailable with these credentials.',
      model: 'anthropic/claude-sonnet-5',
      reason: 'model_unavailable',
      retryable: false,
    });

    await expect(
      assertInferenceProviderConnection({
        providerLabel: 'Anthropic',
        providerEnvVarNames: ['ANTHROPIC_API_KEY'],
        modelId: 'anthropic/claude-sonnet-5',
        credentialValues: [
          { name: 'ANTHROPIC_API_KEY', value: 'candidate-key' },
        ],
      }),
    ).resolves.toBeNull();
  });

  it('saves a key whose account is out of credits and returns a warning instead', async () => {
    // Operators add the provider and top the account up in parallel, so an
    // exhausted account must not block the save the way a bad key does.
    mockValidateNonTaskInference.mockResolvedValue({
      success: false,
      checkedAt: '2026-08-13T12:00:00.000Z',
      latencyMs: 25,
      message:
        'The inference provider account does not have enough credits or quota.',
      model: 'anthropic/claude-sonnet-5',
      reason: 'insufficient_credits',
      retryable: false,
    });

    await expect(
      assertInferenceProviderConnection({
        providerLabel: 'Anthropic',
        providerEnvVarNames: ['ANTHROPIC_API_KEY'],
        modelId: 'anthropic/claude-sonnet-5',
        credentialValues: [
          { name: 'ANTHROPIC_API_KEY', value: 'candidate-key' },
        ],
      }),
    ).resolves.toEqual({
      code: 'insufficient_credits',
      message:
        'The Anthropic account seems to be out of credits or quota. Add credits before using it.',
    });
  });

  it('throws only the sanitized provider failure', async () => {
    mockValidateNonTaskInference.mockResolvedValue({
      success: false,
      checkedAt: '2026-08-13T12:00:00.000Z',
      latencyMs: 25,
      message: 'The inference provider rejected these credentials.',
      model: 'anthropic/claude-sonnet-5',
      reason: 'invalid_credentials',
      retryable: false,
    });

    await expect(
      assertInferenceProviderConnection({
        providerLabel: 'Anthropic',
        providerEnvVarNames: ['ANTHROPIC_API_KEY'],
        modelId: 'anthropic/claude-sonnet-5',
        credentialValues: [
          { name: 'ANTHROPIC_API_KEY', value: 'candidate-key' },
        ],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<InferenceProviderValidationError>>({
        code: 'invalid_credentials',
        message:
          'Anthropic: The inference provider rejected these credentials.',
        retryable: false,
      }),
    );
  });
});

describe('validateSetupModelProviderCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
    mockResolveEffectiveDeploymentEnvVars.mockResolvedValue({
      ANTHROPIC_API_KEY: 'saved-key',
    });
    mockValidateNonTaskInference.mockResolvedValue({
      success: true,
      checkedAt: '2026-08-13T12:00:00.000Z',
      latencyMs: 25,
      model: 'anthropic/claude-sonnet-5',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('skips the live check when the save changes no credentials', async () => {
    await validateSetupModelProviderCredentials({
      provider: getSetupModelProvider('anthropic'),
      action: 'save it',
      modelId: 'anthropic/claude-sonnet-5',
    });

    expect(mockValidateNonTaskInference).not.toHaveBeenCalled();
  });

  it('skips the live check when the UI resubmits the persisted value unchanged', async () => {
    await validateSetupModelProviderCredentials({
      provider: getSetupModelProvider('anthropic'),
      apiKey: 'saved-key',
      action: 'save it',
      modelId: 'anthropic/claude-sonnet-5',
    });

    expect(mockValidateNonTaskInference).not.toHaveBeenCalled();
  });

  it('validates a submitted credential once against the persisted env', async () => {
    await validateSetupModelProviderCredentials({
      provider: getSetupModelProvider('anthropic'),
      apiKey: 'candidate-key',
      action: 'save it',
      modelId: 'anthropic/claude-sonnet-5',
    });

    expect(mockResolveEffectiveDeploymentEnvVars).toHaveBeenCalledTimes(1);
    expect(mockValidateNonTaskInference).toHaveBeenCalledWith({
      model: 'anthropic/claude-sonnet-5',
      runtimeEnv: { ANTHROPIC_API_KEY: 'candidate-key' },
    });
  });

  it('passes an out-of-credits warning through without blocking', async () => {
    mockValidateNonTaskInference.mockResolvedValue({
      success: false,
      checkedAt: '2026-08-13T12:00:00.000Z',
      latencyMs: 25,
      message:
        'The inference provider account does not have enough credits or quota.',
      model: 'anthropic/claude-sonnet-5',
      reason: 'insufficient_credits',
      retryable: false,
    });

    await expect(
      validateSetupModelProviderCredentials({
        provider: getSetupModelProvider('anthropic'),
        apiKey: 'candidate-key',
        action: 'save it',
        modelId: 'anthropic/claude-sonnet-5',
      }),
    ).resolves.toMatchObject({ code: 'insufficient_credits' });
  });
});

describe('validateSetupModelProviderCredentials for Cursor', () => {
  const fetchMock = vi.fn();
  const cursor = () => getSetupModelProvider('cursor');
  const validate = (apiKey?: string) =>
    validateSetupModelProviderCredentials({
      provider: cursor(),
      apiKey,
      action: 'save it',
      modelId: 'cursor/composer-2.5',
    });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockResolveEffectiveDeploymentEnvVars.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks the key against the Cursor API, not the OpenCode canary', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"userId":"u"}', { status: 200 }),
    );

    await expect(validate('cursor-key-123')).resolves.toBeNull();

    expect(mockValidateNonTaskInference).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.cursor.com/v1/me');
    expect(init.headers).toEqual({ Authorization: 'Bearer cursor-key-123' });
  });

  it.each([401, 403])(
    'blocks the save with a clear error on %s',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('no', { status }));

      const error = await validate('bad-key').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InferenceProviderValidationError);
      expect((error as Error).message).toBe(
        'Cursor: Cursor rejected this API key. Check that it is a valid, active key.',
      );
      expect((error as Error).message).not.toContain('bad-key');
    },
  );

  it.each([
    [
      'a network error',
      () => fetchMock.mockRejectedValue(new Error('offline')),
    ],
    [
      'a server error',
      () => fetchMock.mockResolvedValue(new Response('', { status: 503 })),
    ],
  ])('saves with a warning on %s', async (_name, arrange) => {
    arrange();

    await expect(validate('cursor-key-123')).resolves.toMatchObject({
      code: 'validation_unavailable',
      message: expect.stringContaining('could not be verified'),
    });
  });

  it('does not call Cursor when the save changes no key', async () => {
    mockResolveEffectiveDeploymentEnvVars.mockResolvedValue({
      CURSOR_API_KEY: 'saved-key',
    });

    await expect(validate('saved-key')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
