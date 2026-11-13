import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const { renameSpy } = vi.hoisted(() => ({ renameSpy: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  renameSpy.mockImplementation(actual.renameSync);

  return { ...actual, renameSync: renameSpy };
});

import { readMaskSecretsFile, writeMaskSecretsFile } from './mask-secrets-file';

describe('mask secrets file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mask-file-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes only the maskable values, by variable name, to an owner-only file', () => {
    const file = join(dir, 'nested', 'mask-secrets.json');

    writeMaskSecretsFile(
      [
        { name: 'GITLAB_TOKEN', value: 'long-enough-secret' },
        { name: 'PIN', value: 'short' },
      ],
      file,
    );

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([
      { name: 'GITLAB_TOKEN', value: 'long-enough-secret' },
    ]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('makes the file owner-only even when a temp file of an earlier write was left more open', () => {
    const file = join(dir, 'mask-secrets.json');
    writeFileSync(`${file}.${process.pid}.tmp`, 'stale', { mode: 0o644 });

    writeMaskSecretsFile(
      [{ name: 'A_TOKEN', value: 'first-secret-value' }],
      file,
    );

    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('replaces the previous values', () => {
    const file = join(dir, 'mask-secrets.json');

    writeMaskSecretsFile(
      [{ name: 'A_TOKEN', value: 'first-secret-value' }],
      file,
    );
    writeMaskSecretsFile(
      [{ name: 'B_TOKEN', value: 'second-secret-value' }],
      file,
    );

    expect(readMaskSecretsFile(file)).toEqual([
      { name: 'B_TOKEN', value: 'second-secret-value' },
    ]);
    expect(existsSync(file)).toBe(true);
  });

  it('swaps the file in with a rename, so a reader never sees a partial write', () => {
    const file = join(dir, 'mask-secrets.json');
    const before = [{ name: 'A_TOKEN', value: 'first-secret-value' }];
    writeMaskSecretsFile(before, file);
    const seenAtRename: Array<{ from: string; to: string; target: unknown }> =
      [];
    const actualRename = renameSpy.getMockImplementation()!;
    renameSpy.mockImplementationOnce((from: string, to: string) => {
      seenAtRename.push({
        from,
        to,
        target: JSON.parse(readFileSync(file, 'utf8')),
      });
      actualRename(from, to);
    });

    writeMaskSecretsFile(
      [{ name: 'B_TOKEN', value: 'second-secret-value' }],
      file,
    );

    expect(seenAtRename).toHaveLength(1);
    expect(seenAtRename[0]!.to).toBe(file);
    expect(dirname(seenAtRename[0]!.from)).toBe(dirname(file));
    expect(seenAtRename[0]!.from).not.toBe(file);
    expect(seenAtRename[0]!.target).toEqual(before);
    expect(readdirSync(dir)).toEqual(['mask-secrets.json']);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('keeps the previous file, and leaves no temp file, when the swap fails', () => {
    const file = join(dir, 'mask-secrets.json');
    writeMaskSecretsFile(
      [{ name: 'A_TOKEN', value: 'first-secret-value' }],
      file,
    );
    renameSpy.mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    expect(() =>
      writeMaskSecretsFile(
        [{ name: 'B_TOKEN', value: 'second-secret-value' }],
        file,
      ),
    ).toThrow('rename failed');
    expect(readMaskSecretsFile(file)).toEqual([
      { name: 'A_TOKEN', value: 'first-secret-value' },
    ]);
    expect(readdirSync(dir)).toEqual(['mask-secrets.json']);
  });

  it('reads nothing from a missing, unparsable or wrongly shaped file', () => {
    const file = join(dir, 'mask-secrets.json');
    expect(readMaskSecretsFile(file)).toBeUndefined();

    writeFileSync(file, 'not json');
    expect(readMaskSecretsFile(file)).toBeUndefined();

    writeFileSync(file, JSON.stringify({ A_TOKEN: 'an-object-is-wrong' }));
    expect(readMaskSecretsFile(file)).toBeUndefined();

    writeFileSync(file, JSON.stringify(['a-bare-value']));
    expect(readMaskSecretsFile(file)).toBeUndefined();

    writeFileSync(file, JSON.stringify([{ name: 'A_TOKEN', value: 42 }]));
    expect(readMaskSecretsFile(file)).toBeUndefined();
  });

  it('reads an empty file of secrets as no secrets, not as unavailable', () => {
    const file = join(dir, 'mask-secrets.json');
    writeMaskSecretsFile([], file);

    expect(readMaskSecretsFile(file)).toEqual([]);
  });
});
