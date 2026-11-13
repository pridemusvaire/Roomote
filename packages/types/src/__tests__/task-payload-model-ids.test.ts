import { getTaskPayloadModelIds } from '../task-payload-model-ids';

describe('getTaskPayloadModelIds', () => {
  it('returns nothing for a task that selected no model', () => {
    expect(getTaskPayloadModelIds(undefined)).toEqual([]);
    expect(getTaskPayloadModelIds({})).toEqual([]);
  });

  it('returns the coding override and every role override, once each', () => {
    expect(
      getTaskPayloadModelIds({
        harnessModelOverrides: { 'opencode-server': ' cursor/composer-2.5 ' },
        modelRoleOverrides: {
          planning: { model: 'openai/gpt-5' },
          explore: { model: 'openai/gpt-5' },
          vision: { reasoningEffort: 'low' },
        },
      }),
    ).toEqual(['cursor/composer-2.5', 'openai/gpt-5']);
  });
});
