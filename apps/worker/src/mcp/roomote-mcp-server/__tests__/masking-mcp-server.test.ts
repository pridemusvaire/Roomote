import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

import {
  MASK_SECRETS_FILE_ENV,
  writeMaskSecretsFile,
} from '../../../lib/mask-secrets-file';
import { MaskingMcpServer } from '../masking-mcp-server';

const SECRET = 'glpat-super-secret-value-123';
const SECRETS = [{ name: 'GITLAB_TOKEN', value: SECRET }];

let dir: string;
let secretsFile: string;
const originalFile = process.env[MASK_SECRETS_FILE_ENV];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mask-mcp-'));
  secretsFile = join(dir, 'mask-secrets.json');
  process.env[MASK_SECRETS_FILE_ENV] = secretsFile;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalFile === undefined) delete process.env[MASK_SECRETS_FILE_ENV];
  else process.env[MASK_SECRETS_FILE_ENV] = originalFile;
});

/** Calls a tool that records the arguments its handler received. */
async function call(tool: string, args: Record<string, unknown>) {
  const server = new MaskingMcpServer({ name: 'test', version: '1.0.0' });
  const seen: unknown[] = [];
  const handler = async (params: unknown) => {
    seen.push(params);
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  };
  const inputSchema = {
    message: z.string(),
    nested: z.object({ note: z.string() }).optional(),
    items: z.array(z.string()).optional(),
  };

  for (const name of [
    'send_chat_reply',
    'manage_environments',
    'fetch_url',
    'call_integration_tool',
    'brand_new',
  ]) {
    server.registerTool(name, { inputSchema }, handler);
  }
  server.registerTool('get_about_me', {}, async (extra) => {
    seen.push(typeof extra);
    return { content: [{ type: 'text' as const, text: 'pong' }] };
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'client', version: '1.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const result = await client.callTool({ name: tool, arguments: args });
  await client.close();
  const text = (result.content as { text: string }[])[0]!.text;

  return { seen, text };
}

describe('MaskingMcpServer on a task that masks', () => {
  it('masks secret values in every string an outbound tool receives', async () => {
    writeMaskSecretsFile(SECRETS, secretsFile);

    const { seen } = await call('send_chat_reply', {
      message: `token is ${SECRET}`,
      nested: { note: `again ${SECRET}` },
      items: [SECRET, 'fine'],
    });

    expect(seen[0]).toEqual({
      message: 'token is [redacted]',
      nested: { note: 'again [redacted]' },
      items: ['[redacted]', 'fine'],
    });
  });

  it('rejects a persisting tool whose input holds a secret value, naming the variable and never the value', async () => {
    writeMaskSecretsFile(SECRETS, secretsFile);

    const { seen, text } = await call('manage_environments', {
      message: 'x',
      nested: { note: `export TOKEN=${SECRET}` },
    });

    expect(seen).toEqual([]);
    expect(text).toContain('GITLAB_TOKEN');
    expect(text).not.toContain(SECRET);
  });

  it('tells a tool that expands no variables to drop the value, not to refer to a variable', async () => {
    writeMaskSecretsFile(SECRETS, secretsFile);

    for (const tool of ['fetch_url', 'call_integration_tool', 'brand_new']) {
      const { seen, text } = await call(tool, { message: `x ${SECRET}` });

      expect(seen).toEqual([]);
      expect(text).toContain('GITLAB_TOKEN');
      expect(text).toMatch(/remove the value/i);
      expect(text).toMatch(/stored credentials/i);
      expect(text).not.toContain('$GITLAB_TOKEN');
      expect(text).not.toContain(SECRET);
    }
  });

  it('tells a tool that stores text for a shell to refer to the variable by name', async () => {
    writeMaskSecretsFile(SECRETS, secretsFile);

    const { text } = await call('manage_environments', {
      message: `x ${SECRET}`,
    });

    expect(text).toContain('$GITLAB_TOKEN');
    expect(text).not.toContain(SECRET);
  });

  it('tells the agent to remove a repository credential, which has no variable to refer to', async () => {
    const credential = 'ghs_installation-credential-456';
    writeMaskSecretsFile(
      [...SECRETS, { name: 'GIT_CREDENTIAL', value: credential }],
      secretsFile,
    );

    const only = await call('manage_environments', {
      message: `x ${credential}`,
    });
    expect(only.seen).toEqual([]);
    expect(only.text).toMatch(/remove the value/i);
    expect(only.text).not.toContain('$GIT_CREDENTIAL');
    expect(only.text).not.toContain(credential);

    const mixed = await call('manage_environments', {
      message: `x ${credential} ${SECRET}`,
    });
    expect(mixed.text).toContain('$GITLAB_TOKEN');
    expect(mixed.text).toMatch(/remove the repository credential/i);
    expect(mixed.text).not.toContain('$GIT_CREDENTIAL');
  });

  it('lets a persisting tool through when its input holds no secret value', async () => {
    writeMaskSecretsFile(SECRETS, secretsFile);

    const { seen } = await call('manage_environments', {
      message: 'use $GITLAB_TOKEN',
    });

    expect(seen[0]).toEqual({ message: 'use $GITLAB_TOKEN' });
  });

  it('rejects, by default, a tool nobody has classified', async () => {
    writeMaskSecretsFile(SECRETS, secretsFile);

    const { seen, text } = await call('brand_new', { message: SECRET });

    expect(seen).toEqual([]);
    expect(text).toContain('GITLAB_TOKEN');
  });

  it('honours a file rewritten while the server runs', async () => {
    writeMaskSecretsFile([], secretsFile);
    writeMaskSecretsFile(SECRETS, secretsFile);

    const { seen } = await call('send_chat_reply', { message: SECRET });

    expect(seen[0]).toEqual({ message: '[redacted]' });
  });

  describe('with a development default such as POSTGRES_PASSWORD=postgres', () => {
    const DEFAULT = [{ name: 'POSTGRES_PASSWORD', value: 'postgres' }];

    it('lets a tool that rejects through when the word is ordinary text', async () => {
      writeMaskSecretsFile(DEFAULT, secretsFile);

      const { seen } = await call('manage_environments', {
        message: 'image postgres:16',
      });

      expect(seen[0]).toEqual({ message: 'image postgres:16' });
    });

    it('still rejects the same call once the value looks like a real secret', async () => {
      writeMaskSecretsFile(
        [{ name: 'POSTGRES_PASSWORD', value: 'pg-S3cret-9xK2' }],
        secretsFile,
      );

      const { seen, text } = await call('manage_environments', {
        message: 'image postgres:16 password pg-S3cret-9xK2',
      });

      expect(seen).toEqual([]);
      expect(text).toContain('POSTGRES_PASSWORD');
    });

    it('still masks it in text that leaves the sandbox', async () => {
      writeMaskSecretsFile(DEFAULT, secretsFile);

      const { seen } = await call('send_chat_reply', {
        message: 'the password is postgres',
      });

      expect(seen[0]).toEqual({ message: 'the password is [redacted]' });
    });
  });

  it('ignores values too short to mask without mangling text', async () => {
    writeMaskSecretsFile([{ name: 'PIN', value: 'short' }], secretsFile);

    const { seen } = await call('send_chat_reply', { message: 'a short one' });

    expect(seen[0]).toEqual({ message: 'a short one' });
  });

  it.each(['send_chat_reply', 'manage_environments', 'brand_new'])(
    'fails closed on %s when the secrets file is missing, without running the tool',
    async (tool) => {
      const { seen, text } = await call(tool, { message: SECRET });

      expect(seen).toEqual([]);
      expect(text).toContain('secret');
      expect(text).not.toContain(SECRET);
    },
  );

  it('fails closed when the secrets file is not valid', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(secretsFile, 'not json');

    const { seen } = await call('send_chat_reply', { message: SECRET });

    expect(seen).toEqual([]);
  });

  it('leaves tools without input untouched', async () => {
    const { seen } = await call('get_about_me', {});

    expect(seen[0]).toBe('object');
  });
});

describe('MaskingMcpServer on a task that does not mask (OpenCode)', () => {
  beforeEach(() => {
    delete process.env[MASK_SECRETS_FILE_ENV];
  });

  it.each(['send_chat_reply', 'manage_environments', 'brand_new'])(
    'passes the input of %s through unchanged',
    async (tool) => {
      const { seen } = await call(tool, { message: `token is ${SECRET}` });

      expect(seen[0]).toEqual({ message: `token is ${SECRET}` });
    },
  );
});
