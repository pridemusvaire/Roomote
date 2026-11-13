import {
  MASK_SECRETS_FILE_ENV,
  readMaskSecretsFile,
} from '../../lib/mask-secrets-file.js';
import {
  maskableSecrets,
  maskDeep,
} from '../../sandbox-server/lib/harnesses/cursor-acp/secret-mask.js';
import { looksLikeRealSecret } from '../../sandbox-server/lib/harnesses/cursor-acp/secret-strength.js';

import { namesInInput } from './secrets-in-input.js';
import { refusal } from './tool-secret-refusal.js';
import { toolSecretPolicy } from './tool-secret-policy.js';

type SecretGuardVerdict =
  | { proceed: true; input: unknown }
  | { proceed: false; error: string };

const UNAVAILABLE =
  'The list of secret values to keep out of this call is unavailable (the sandbox may be preparing a snapshot), so the call was not made. Try again in a moment.';

/**
 * Decides what a tool may receive. A task with no secrets file (OpenCode) is
 * not masked at all. A task that has one must be able to read it: unreadable
 * means refuse, because carrying on would send a secret out unmasked.
 */
export function guardToolInput(
  toolName: string,
  input: unknown,
): SecretGuardVerdict {
  const file = process.env[MASK_SECRETS_FILE_ENV];

  if (!file) {
    return { proceed: true, input };
  }

  const secrets = readMaskSecretsFile(file);

  if (!secrets) {
    return { proceed: false, error: UNAVAILABLE };
  }

  const values = maskableSecrets(secrets.map(({ value }) => value));
  const maskable = secrets.filter(({ value }) => values.includes(value));

  const policy = toolSecretPolicy(toolName);

  if (policy === 'mask') {
    return { proceed: true, input: maskDeep(input, values) };
  }

  // Only a value that looks like a real secret is refused. A development
  // default (`POSTGRES_PASSWORD=postgres`) is a plain word that ordinary calls
  // contain (an image `postgres:16`), and refusing those leaves the agent
  // unable to recover. Masking above still covers it for outbound text.
  const names = namesInInput(
    input,
    maskable.filter(({ value }) => looksLikeRealSecret(value)),
  );

  return names.length === 0
    ? { proceed: true, input }
    : {
        proceed: false,
        error: refusal(toolName, names, policy === 'reject-reference'),
      };
}
