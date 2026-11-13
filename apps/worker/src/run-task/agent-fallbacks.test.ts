import { describe, expect, it } from 'vitest';

import { buildAgentFallbacks } from './agent-fallbacks';

const roleEnv = {
  R_VISION_MODEL_FALLBACK: 'openrouter/z-ai/glm-5.3',
  R_VISION_MODEL_FALLBACK_REASONING_EFFORT: 'low',
};

describe('buildAgentFallbacks', () => {
  it('runs an inheriting subagent role on the effective coding model', () => {
    expect(
      buildAgentFallbacks(roleEnv, 'openrouter/openai/gpt-5.6-luna'),
    ).toMatchObject({
      visual: {
        role: 'vision',
        activeModelId: 'openrouter/openai/gpt-5.6-luna',
        fallbackModel: 'openrouter/z-ai/glm-5.3',
        fallbackReasoningEffort: 'low',
      },
    });
  });

  it('gives an inheriting role no fallback when coding is a Cursor model', () => {
    expect(buildAgentFallbacks(roleEnv, 'cursor/composer-2.5')).toEqual({});
  });

  it('keeps a role that has its own non-Cursor model', () => {
    expect(
      buildAgentFallbacks(
        { ...roleEnv, R_VISION_MODEL: 'openrouter/google/gemini-3.8-flash' },
        'cursor/composer-2.5',
      ),
    ).toMatchObject({
      visual: { activeModelId: 'openrouter/google/gemini-3.8-flash' },
    });
  });

  it('never falls back onto a Cursor model', () => {
    expect(
      buildAgentFallbacks(
        { ...roleEnv, R_VISION_MODEL_FALLBACK: 'cursor/composer-2.5' },
        'openrouter/openai/gpt-5.6-luna',
      ),
    ).toEqual({});
  });
});
