import { getNonCursorModelProviderCredentialEnvVarNames } from '../non-cursor-provider-credentials';

describe('getNonCursorModelProviderCredentialEnvVarNames', () => {
  it('names the default provider credentials but not the Cursor key', () => {
    const names = getNonCursorModelProviderCredentialEnvVarNames({});

    expect(names).toContain('OPENAI_API_KEY');
    expect(names).toContain('ANTHROPIC_API_KEY');
    expect(names).not.toContain('CURSOR_API_KEY');
  });

  it('includes the credentials a deployment declares itself', () => {
    const names = getNonCursorModelProviderCredentialEnvVarNames({
      R_MODEL_ENV_KEYS: 'MY_PROVIDER_KEY, OTHER_KEY',
    });

    expect(names).toEqual(
      expect.arrayContaining(['MY_PROVIDER_KEY', 'OTHER_KEY']),
    );
  });

  it('leaves non-secret provider settings alone', () => {
    expect(getNonCursorModelProviderCredentialEnvVarNames({})).not.toContain(
      'AWS_REGION',
    );
  });

  it('does not treat a declared Cursor key as foreign', () => {
    expect(
      getNonCursorModelProviderCredentialEnvVarNames({
        R_MODEL_ENV_KEYS: 'CURSOR_API_KEY',
      }),
    ).not.toContain('CURSOR_API_KEY');
  });
});
