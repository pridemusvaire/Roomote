const { mockFindFirst, mockFetchResolvedRuntimeEnvVars } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFetchResolvedRuntimeEnvVars: vi.fn(),
}));

vi.mock('@roomote/db/server', () => ({
  db: { query: { taskRuns: { findFirst: mockFindFirst } } },
  taskRuns: { id: 'taskRuns.id' },
  eq: vi.fn(),
}));

vi.mock('../dequeue-helpers', () => ({
  fetchResolvedRuntimeEnvVars: mockFetchResolvedRuntimeEnvVars,
}));

import type { RunTokenContext } from '@roomote/types';

import { getResolvedRuntimeEnvVars } from '../get-resolved-runtime-env-vars';

const auth: RunTokenContext = {
  runId: 7,
  userId: 'user_1',
  principal: 'user',
  tokenType: 'run',
  version: 1,
};

describe('getResolvedRuntimeEnvVars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchResolvedRuntimeEnvVars.mockResolvedValue({ A: '1' });
  });

  it('resolves keys for the models the run switched to, as a live reload must', async () => {
    const payload = {
      harnessModelOverrides: { 'opencode-server': 'cursor/composer-2.5' },
    };
    mockFindFirst.mockResolvedValue({ id: 7, payload });

    expect(await getResolvedRuntimeEnvVars(auth, { runId: 7 })).toEqual({
      A: '1',
    });
    expect(mockFetchResolvedRuntimeEnvVars).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ taskPayload: payload }),
    );
  });

  it('fails for an unknown run', async () => {
    mockFindFirst.mockResolvedValue(undefined);

    await expect(getResolvedRuntimeEnvVars(auth, { runId: 7 })).rejects.toThrow(
      'Task run not found',
    );
  });
});
