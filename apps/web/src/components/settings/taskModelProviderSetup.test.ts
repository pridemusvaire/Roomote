import { buildSetupModelStatus } from '@roomote/types';

import { splitInferenceProviders } from './taskModelProviderSetup';

function availableIds(env: Record<string, string>): string[] {
  const { availableProviders } = splitInferenceProviders(
    buildSetupModelStatus({ persistedEnvVarNames: Object.keys(env) }),
  );

  return availableProviders.map((provider) => provider.id);
}

describe('splitInferenceProviders', () => {
  it('does not offer Cursor while no other provider is connected', () => {
    expect(availableIds({})).not.toContain('cursor');
  });

  it('does not count a Cursor-only connection as another provider', () => {
    expect(availableIds({ CURSOR_API_KEY: 'key' })).not.toContain('cursor');
  });

  it('offers Cursor once another provider is connected', () => {
    expect(availableIds({ OPENROUTER_API_KEY: 'key' })).toContain('cursor');
  });
});
