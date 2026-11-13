import { readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { maskableSecrets } from '../sandbox-server/lib/harnesses/cursor-acp/secret-mask';

import { writeFileAtomically } from './write-file-atomically';

/**
 * Names the file that lists the task's secret variables for the Roomote MCP
 * server. Only a Cursor task gets it (OpenCode keeps secrets out of its tool
 * calls with its own plugin). The server is a child of the agent and gets no
 * secret in its own environment, so it reads the values from this owner-only
 * file. They never travel in an argument or an environment variable.
 */
export const MASK_SECRETS_FILE_ENV = 'ROOMOTE_MASK_SECRETS_FILE';

export const MASK_SECRETS_FILE_PATH = join(
  homedir(),
  '.roomote',
  'mask-secrets.json',
);

/**
 * A secret value with the variable it belongs to. The name lets an error say
 * what to use instead of the value. A variable that was rotated has one entry
 * per value it held.
 */
export interface MaskSecret {
  name: string;
  value: string;
}

/**
 * Replaces the file's content with the maskable secrets among `secrets`. The
 * write is atomic, so the MCP server reading at the same moment sees the old
 * list or the new one, never a half-written file (which it would take for
 * "unavailable" and refuse the call over).
 */
export function writeMaskSecretsFile(
  secrets: readonly MaskSecret[],
  file: string = MASK_SECRETS_FILE_PATH,
): void {
  const maskable = secrets.filter(
    ({ value }) => maskableSecrets([value]).length > 0,
  );

  writeFileAtomically(file, JSON.stringify(maskable));
}

function isMaskSecret(item: unknown): item is MaskSecret {
  return (
    item !== null &&
    typeof item === 'object' &&
    typeof (item as MaskSecret).name === 'string' &&
    typeof (item as MaskSecret).value === 'string'
  );
}

/**
 * The secrets in the file, or `undefined` when it is missing or unreadable:
 * the caller cannot tell "no secrets" from "secrets I cannot see", and must
 * treat the second as a reason to refuse, not to carry on unmasked.
 */
export function readMaskSecretsFile(
  file: string = MASK_SECRETS_FILE_PATH,
): MaskSecret[] | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));

    return Array.isArray(parsed) && parsed.every(isMaskSecret)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the file, as when the task runs on an engine that has no use for it. */
export function removeMaskSecretsFile(
  file: string = MASK_SECRETS_FILE_PATH,
): void {
  rmSync(file, { force: true });
}
