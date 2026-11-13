const { writeMock, removeMock } = vi.hoisted(() => ({
  writeMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('./mask-secrets-file', () => ({
  writeMaskSecretsFile: writeMock,
  removeMaskSecretsFile: removeMock,
}));

import {
  engageCredentialWriteBarrier,
  resetCredentialWriteBarrierForTesting,
} from './credential-write-barrier';
import {
  onTaskSecretsAdded,
  publishTaskSecrets,
  recordTaskSecretEntries,
  recordTaskSecrets,
  refreshMaskSecretsFile,
  resetTaskSecretsForTesting,
  taskSecretValues,
  useMaskSecretsFile,
} from './task-secrets';
import { taskSecretEntries } from './task-secret-registry';

beforeEach(() => {
  vi.clearAllMocks();
  resetTaskSecretsForTesting();
  resetCredentialWriteBarrierForTesting();
});

describe('task secrets', () => {
  it('collects the secret-named variables of every env it is shown, keeping earlier ones', () => {
    recordTaskSecrets({ GITLAB_TOKEN: 'gitlab-secret-value', PATH: '/bin' });
    recordTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });

    expect(taskSecretValues().sort()).toEqual([
      'added-mid-task-value',
      'gitlab-secret-value',
    ]);
  });

  it('keeps a value masked, under its variable, after the variable is rotated', async () => {
    recordTaskSecrets({ GITLAB_TOKEN: 'old-secret-value-1' });
    recordTaskSecrets({ GITLAB_TOKEN: 'new-secret-value-2' });
    await useMaskSecretsFile(true);

    expect(taskSecretValues().sort()).toEqual([
      'new-secret-value-2',
      'old-secret-value-1',
    ]);
    expect(writeMock).toHaveBeenCalledWith([
      { name: 'GITLAB_TOKEN', value: 'old-secret-value-1' },
      { name: 'GITLAB_TOKEN', value: 'new-secret-value-2' },
    ]);
  });

  it('writes the file, by variable name, when a task starts using it', async () => {
    recordTaskSecrets({ GITLAB_TOKEN: 'gitlab-secret-value' });

    await useMaskSecretsFile(true);

    expect(writeMock).toHaveBeenCalledWith([
      { name: 'GITLAB_TOKEN', value: 'gitlab-secret-value' },
    ]);
  });

  it('rewrites the file with secrets added later', async () => {
    await useMaskSecretsFile(true);
    recordTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });
    await refreshMaskSecretsFile();

    expect(writeMock).toHaveBeenLastCalledWith([
      { name: 'NEW_API_KEY', value: 'added-mid-task-value' },
    ]);
  });

  it('writes nothing, and removes the file, for a task that does not use it', async () => {
    await useMaskSecretsFile(false);
    recordTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });
    await refreshMaskSecretsFile();

    expect(writeMock).not.toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('skips the write while a snapshot holds the credential barrier, and writes on the next refresh', async () => {
    recordTaskSecrets({ GITLAB_TOKEN: 'gitlab-secret-value' });
    await engageCredentialWriteBarrier();

    await useMaskSecretsFile(true);
    expect(writeMock).not.toHaveBeenCalled();

    resetCredentialWriteBarrierForTesting();
    await refreshMaskSecretsFile();
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  describe('listeners', () => {
    it('hands every value to a listener when a new one arrives, not when nothing is new', () => {
      const listener = vi.fn();
      onTaskSecretsAdded(listener);

      recordTaskSecrets({ GITLAB_TOKEN: 'gitlab-secret-value' });
      recordTaskSecrets({ GITLAB_TOKEN: 'gitlab-secret-value', PATH: '/bin' });
      recordTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenNthCalledWith(1, ['gitlab-secret-value']);
      expect(listener).toHaveBeenNthCalledWith(2, [
        'gitlab-secret-value',
        'added-mid-task-value',
      ]);
    });

    it('stops telling a listener once it unsubscribes', () => {
      const listener = vi.fn();
      const unsubscribe = onTaskSecretsAdded(listener);

      unsubscribe();
      recordTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('lets a value that is also a variable take that name over the generic credential one, never the reverse', () => {
      recordTaskSecretEntries([
        ['GIT_CREDENTIAL', 'shared-secret-value'],
        ['GH_TOKEN', 'shared-secret-value'],
        ['GIT_CREDENTIAL', 'shared-secret-value'],
        ['OTHER_TOKEN', 'shared-secret-value'],
      ]);

      expect(taskSecretEntries()).toEqual([
        { name: 'GH_TOKEN', value: 'shared-secret-value' },
      ]);
    });

    it('takes in named values that did not come from an env', () => {
      const listener = vi.fn();
      onTaskSecretsAdded(listener);

      recordTaskSecretEntries([['GIT_CREDENTIAL', 'repo-credential-value']]);

      expect(listener).toHaveBeenCalledWith(['repo-credential-value']);
    });
  });

  describe('publishTaskSecrets', () => {
    it('records, tells the listeners, then rewrites the file', async () => {
      const order: string[] = [];
      await useMaskSecretsFile(true);
      writeMock.mockImplementation(() => order.push('file'));
      onTaskSecretsAdded(() => order.push('listener'));

      await publishTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });

      expect(order).toEqual(['listener', 'file']);
      expect(writeMock).toHaveBeenLastCalledWith([
        { name: 'NEW_API_KEY', value: 'added-mid-task-value' },
      ]);
    });

    it('still tells the listeners while a snapshot holds the barrier, leaving the file for the restore', async () => {
      const listener = vi.fn();
      await useMaskSecretsFile(true);
      writeMock.mockClear();
      onTaskSecretsAdded(listener);
      await engageCredentialWriteBarrier();

      await publishTaskSecrets({ NEW_API_KEY: 'added-mid-task-value' });

      expect(listener).toHaveBeenCalledWith(['added-mid-task-value']);
      expect(writeMock).not.toHaveBeenCalled();
    });
  });
});
