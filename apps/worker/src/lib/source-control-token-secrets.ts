import {
  getSourceControlTokenEnvVars,
  type SourceControlTokenMetadata,
} from '@roomote/types';

import { applySourceControlTokenMetadata } from './github-token';
import { GIT_CREDENTIAL_NAME } from './git-credential-name';
import { removeMaskSecretsFile } from './mask-secrets-file';
import {
  recordTaskSecretEntries,
  refreshMaskSecretsFile,
} from './task-secrets';

type SourceControlTokens = Pick<
  SourceControlTokenMetadata,
  'envVars' | 'gitCredentials' | 'gitProxyCredentials'
>;

function* tokenEntries(
  tokens: SourceControlTokens,
): Generator<[name: string, value: string]> {
  // The env may be a whole task env: only the token variables are tokens.
  const envVars = getSourceControlTokenEnvVars().flatMap((name) => {
    const token = tokens.envVars?.[name];

    return token ? [[name, token] as [string, string]] : [];
  });
  const credentials = [
    ...(tokens.gitCredentials ?? []),
    ...(tokens.gitProxyCredentials ?? []),
  ];

  yield* envVars;

  // A credential is named after a token variable only when it is that token.
  for (const { token } of credentials) {
    if (token) {
      yield [
        envVars.find(([, value]) => value === token)?.[0] ??
          GIT_CREDENTIAL_NAME,
        token,
      ];
    }
  }
}

/**
 * The one way source-control tokens reach the task: at start, and on every
 * refresh (GitHub, GitLab, Gitea, Azure DevOps, Bitbucket alike). A token the
 * agent can read from a file or a shell is a secret, so before it is written
 * it is recorded, announced to the live harness, and put in the mask file
 * (unless a snapshot holds the credential write barrier, in which case the
 * restore rewrites the file). `null` clears the token files. A mask file that
 * cannot be written (a full disk) never keeps the tokens from being written:
 * the file is removed instead, so the MCP server refuses its calls.
 */
export async function applySourceControlTokens(
  tokens?: SourceControlTokens | null,
): Promise<void> {
  if (tokens) {
    recordTaskSecretEntries(tokenEntries(tokens));
    await refreshOrRemoveMaskSecretsFile();
  }

  await applySourceControlTokenMetadata(tokens);
}

async function refreshOrRemoveMaskSecretsFile(): Promise<void> {
  try {
    await refreshMaskSecretsFile();
  } catch (error) {
    console.error(
      `[source-control-token-secrets] Mask secrets file not written; removing it so secret-guarded tools fail closed: ${describe(error)}`,
    );

    try {
      removeMaskSecretsFile();
    } catch (removeError) {
      console.error(
        `[source-control-token-secrets] Mask secrets file not removed: ${describe(removeError)}`,
      );
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
