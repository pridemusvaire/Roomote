import { describe, expect, it } from 'vitest';

import {
  CURSOR_PROVIDER_ID,
  DEFAULT_MODEL_PROVIDER_ENV_KEYS,
  INFERENCE_GATEWAY_PROVIDER_ENV_VAR_NAMES,
  getSetupModelProvider,
  isCursorTaskModelId,
  isTaskModelAllowedForRole,
  normalizeTaskModelId,
  toCursorAgentModelPrefix,
} from '../index';

describe('Cursor task models', () => {
  it('recognizes cursor/ model ids', () => {
    expect(CURSOR_PROVIDER_ID).toBe('cursor');
    expect(isCursorTaskModelId('cursor/composer-2.5')).toBe(true);
    expect(isCursorTaskModelId('  cursor/composer-2.5 ')).toBe(true);
    expect(isCursorTaskModelId('xai/grok-4.7')).toBe(false);
    expect(isCursorTaskModelId('openrouter/cursor/composer-2.5')).toBe(false);
    expect(isCursorTaskModelId('cursor')).toBe(false);
    expect(isCursorTaskModelId('')).toBe(false);
    expect(isCursorTaskModelId(undefined)).toBe(false);
    expect(isCursorTaskModelId(null)).toBe(false);
  });

  it('strips the provider prefix for the Cursor agent', () => {
    expect(toCursorAgentModelPrefix('cursor/composer-2.5')).toBe(
      'composer-2.5',
    );
    expect(toCursorAgentModelPrefix(' cursor/composer-2.5 ')).toBe(
      'composer-2.5',
    );
  });

  it('keeps cursor/ ids as direct model ids instead of OpenRouter slugs', () => {
    expect(normalizeTaskModelId('cursor/composer-2.5')).toBe(
      'cursor/composer-2.5',
    );
  });

  it('registers a Cursor API-key provider in the setup catalog', () => {
    expect(getSetupModelProvider('cursor')).toMatchObject({
      id: 'cursor',
      label: 'Cursor',
      envVarName: 'CURSOR_API_KEY',
      authKind: 'api-key',
      defaultRoomoteModel: 'cursor/composer-2.5',
    });
    expect(
      getSetupModelProvider('cursor').suggestedTaskModels.map(
        (model) => model.id,
      ),
    ).toEqual(['cursor/composer-2.5']);
  });

  it('allows Cursor models only for the coding role', () => {
    expect(isTaskModelAllowedForRole('coding', 'cursor/composer-2.5')).toBe(
      true,
    );
    expect(isTaskModelAllowedForRole('helper', 'cursor/composer-2.5')).toBe(
      false,
    );
    expect(isTaskModelAllowedForRole('planning', 'z-ai/glm-5.6')).toBe(true);
  });

  it('cannot be the only provider: it is flagged as needing another one', () => {
    expect(getSetupModelProvider('cursor').requiresOtherProvider).toBe(true);
    expect(getSetupModelProvider('openrouter').requiresOtherProvider).toBe(
      undefined,
    );
  });

  it('forwards CURSOR_API_KEY to the worker instead of gateway-covering it', () => {
    expect(DEFAULT_MODEL_PROVIDER_ENV_KEYS).toContain('CURSOR_API_KEY');
    expect(INFERENCE_GATEWAY_PROVIDER_ENV_VAR_NAMES).not.toContain(
      'CURSOR_API_KEY',
    );
  });
});
