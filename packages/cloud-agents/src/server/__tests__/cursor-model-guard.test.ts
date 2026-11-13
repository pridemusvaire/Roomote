import { describe, expect, it } from 'vitest';

import {
  hasCursorRoleModel,
  ignoreCursorModel,
  withoutCursorRoleModels,
} from '../cursor-model-guard';

describe('cursor model guard', () => {
  it('ignores only Cursor model ids', () => {
    expect(ignoreCursorModel('cursor/composer-2.5')).toBeUndefined();
    expect(ignoreCursorModel('openrouter/openai/gpt-5.4')).toBe(
      'openrouter/openai/gpt-5.4',
    );
    expect(ignoreCursorModel(undefined)).toBeUndefined();
  });

  it('removes Cursor role models and fallbacks but keeps everything else', () => {
    const env = {
      R_MODEL: 'cursor/composer-2.5',
      R_SMALL_MODEL: 'openrouter/openai/gpt-5.4',
      R_ORCHESTRATION_MODEL_FALLBACK: 'cursor/composer-2.5',
      CURSOR_API_KEY: 'cursor-key',
    };

    expect(hasCursorRoleModel(env)).toBe(true);
    expect(withoutCursorRoleModels(env)).toEqual({
      R_SMALL_MODEL: 'openrouter/openai/gpt-5.4',
      CURSOR_API_KEY: 'cursor-key',
    });
    // The input is never mutated.
    expect(env.R_MODEL).toBe('cursor/composer-2.5');
    expect(hasCursorRoleModel(withoutCursorRoleModels(env))).toBe(false);
  });
});
