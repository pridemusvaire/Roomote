import {
  CursorModelUnavailableError,
  resolveCursorAgentModelId,
} from '../cursor-acp/model-selection';

const available = [
  { modelId: 'default[]' },
  { modelId: 'composer-2.5[fast=true]' },
  { modelId: 'composer-2.5[fast=false]' },
  { modelId: 'composer-2' },
];

describe('resolveCursorAgentModelId', () => {
  it('prefers an exact match', () => {
    expect(resolveCursorAgentModelId('composer-2', available)).toBe(
      'composer-2',
    );
  });

  it('prefers the variant that is not fast when only a variant is listed', () => {
    expect(resolveCursorAgentModelId('composer-2.5', available)).toBe(
      'composer-2.5[fast=false]',
    );
  });

  it('finds fast=false among several variant params', () => {
    expect(
      resolveCursorAgentModelId('composer-2.5', [
        { modelId: 'composer-2.5[fast=true,thinking=high]' },
        { modelId: 'composer-2.5[thinking=high,fast=false]' },
      ]),
    ).toBe('composer-2.5[thinking=high,fast=false]');
  });

  it('takes the first listed variant when none says fast=false', () => {
    expect(
      resolveCursorAgentModelId('composer-2.5', [
        { modelId: 'composer-2.5[fast=true]' },
        { modelId: 'composer-2.5[thinking=high]' },
      ]),
    ).toBe('composer-2.5[fast=true]');
  });

  it('uses the fast variant when it is the only one Cursor lists', () => {
    expect(
      resolveCursorAgentModelId('composer-2.5', [
        { modelId: 'default[]' },
        { modelId: 'composer-2.5[fast=true]' },
      ]),
    ).toBe('composer-2.5[fast=true]');
  });

  it('does not treat a longer model name as a prefix match', () => {
    expect(() =>
      resolveCursorAgentModelId('composer', [{ modelId: 'composer-2' }]),
    ).toThrow(CursorModelUnavailableError);
  });

  it('throws an error that lists the available ids', () => {
    let caught: unknown;

    try {
      resolveCursorAgentModelId('gpt-9', available);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CursorModelUnavailableError);
    const message = (caught as Error).message;
    expect(message).toContain('gpt-9');
    expect(message).toContain('composer-2.5[fast=true]');
    expect(message).toContain('composer-2');
  });

  it('reports an empty model list explicitly', () => {
    expect(() => resolveCursorAgentModelId('composer-2.5', [])).toThrow(/none/);
  });
});
