import { describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: { deploymentSettings: { findFirst: vi.fn() } },
    transaction: vi.fn(),
  },
}));

vi.mock('@roomote/db/server', () => ({
  db: dbMock,
  deploymentSettings: {},
  eq: vi.fn(),
  isChatGptSubscriptionConnected: vi.fn(),
  taskRuns: {},
  tasks: {},
}));

import {
  TaskModelSelectionError,
  applyTaskModelSelectionToRun,
} from '../task-model-selection';

describe('applyTaskModelSelectionToRun with a Cursor model', () => {
  it.each(['helper', 'vision', 'codeReview', 'planning'] as const)(
    'rejects a Cursor model for the %s role before touching the run',
    async (role) => {
      // OpenCode runs every role except coding, and cannot run Cursor models.
      const result = applyTaskModelSelectionToRun({
        runId: 1,
        role,
        model: 'cursor/composer-2.5',
        reasoningEffort: null,
      });

      await expect(result).rejects.toBeInstanceOf(TaskModelSelectionError);
      await expect(result).rejects.toMatchObject({ code: 'invalid_model' });
      expect(dbMock.query.deploymentSettings.findFirst).not.toHaveBeenCalled();
      expect(dbMock.transaction).not.toHaveBeenCalled();
    },
  );
});
