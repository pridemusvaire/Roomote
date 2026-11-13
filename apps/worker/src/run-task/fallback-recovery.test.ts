import { buildFallbackRecoveryMessage } from './fallback-recovery';

const base = {
  role: 'coding',
  fromModelId: 'cursor/composer-2.5',
  toModelId: 'openai/gpt-5',
  toReasoningEffort: null,
  errorSummary: 'limit',
  trigger: 'immediate',
} as const;

describe('buildFallbackRecoveryMessage', () => {
  it('replays a prompt that never reached a model, as it was', () => {
    const replayPrompt = {
      text: 'build it',
      userId: 'u1',
      clientMessageId: 'c1',
      visibleInTranscript: false,
    };

    expect(buildFallbackRecoveryMessage({ ...base, replayPrompt })).toEqual({
      ...replayPrompt,
      source: 'model-fallback-replay',
    });
  });

  it('keeps the source a replayed prompt already had', () => {
    expect(
      buildFallbackRecoveryMessage({
        ...base,
        replayPrompt: { text: 'hi', source: 'slack' },
      }).source,
    ).toBe('slack');
  });

  it('asks the agent to continue when work had started', () => {
    expect(buildFallbackRecoveryMessage(base)).toEqual({
      text: expect.stringContaining('Continue.'),
      visibleInTranscript: false,
      source: 'model-fallback-recovery',
    });
  });

  it('asks a failed delegation to be re-run', () => {
    expect(
      buildFallbackRecoveryMessage({ ...base, agentType: 'explore' }).text,
    ).toContain('The explore delegation failed');
  });
});
