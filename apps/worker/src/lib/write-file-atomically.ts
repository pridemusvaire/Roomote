import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Replaces `file` with `content`, owner-only (0600) in an owner-only (0700)
 * directory. The content is written to a temp file beside it and renamed over
 * it, so a reader at the same moment sees the old content or the new, never a
 * half-written file.
 */
export function writeFileAtomically(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });

  const temp = `${file}.${process.pid}.tmp`;

  try {
    writeFileSync(temp, content, { mode: 0o600 });
    // `mode` applies only when the file is created: a temp left by an earlier
    // crashed write (same pid) keeps whatever mode it had.
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
