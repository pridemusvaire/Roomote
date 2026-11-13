import {
  startFakeCursorHarness,
  startTask,
  waitFor,
} from './cursor-acp-test-harness';
import { buildCursorAgentEnv } from '../cursor-acp/agent-env';

const CURSOR_KEY = 'cursor-key-secret-value-1';
const GITLAB_TOKEN = 'gitlab-token-secret-value-2';
const OPENAI_KEY = 'openai-key-secret-value-3';

const live: Awaited<ReturnType<typeof startFakeCursorHarness>>[] = [];
afterEach(() => live.splice(0).forEach((fake) => fake.dispose()));

/** What the agent produced: everything but the user's own prompt. */
const agentOutput = (fake: Awaited<ReturnType<typeof runTurn>>) =>
  [...fake.persisted, ...fake.live].filter((e) => e.role !== 'user');

async function runTurn(prompt: string, extraEnv: Record<string, string> = {}) {
  const fake = await startFakeCursorHarness({
    env: {
      ...extraEnv,
      CURSOR_API_KEY: CURSOR_KEY,
      GITLAB_TOKEN,
      OPENAI_API_KEY: OPENAI_KEY,
      CUSTOM_PROVIDER_KEY: 'custom-provider-secret-value-4',
      R_MODEL_ENV_KEYS: 'CUSTOM_PROVIDER_KEY',
    },
  });
  live.push(fake);
  fake.harness.sendCommand(startTask(prompt));
  await waitFor(() => fake.timeline.includes('task:taskCompleted'));
  return fake;
}

describe('buildCursorAgentEnv', () => {
  it('drops model-provider credentials except the Cursor key and keeps the rest', () => {
    const env = buildCursorAgentEnv({
      CURSOR_API_KEY: 'cursor',
      OPENAI_API_KEY: 'openai',
      ANTHROPIC_API_KEY: 'anthropic',
      OPENROUTER_API_KEY: 'openrouter',
      LITELLM_API_KEY: 'litellm',
      MY_PROVIDER_KEY: 'declared',
      R_MODEL_ENV_KEYS: 'MY_PROVIDER_KEY',
      GITLAB_TOKEN: 'gitlab',
      BASH_ENV: '/home/u/.roomote/env.sh',
      PATH: '/usr/bin',
    });

    expect(env).toEqual({
      CURSOR_API_KEY: 'cursor',
      R_MODEL_ENV_KEYS: 'MY_PROVIDER_KEY',
      GITLAB_TOKEN: 'gitlab',
      BASH_ENV: '/home/u/.roomote/env.sh',
      PATH: '/usr/bin',
      // Tells the shell env file to keep the dropped keys out of the agent's
      // shells too (see `injectEnvVars`).
      ROOMOTE_OMIT_MODEL_PROVIDER_KEYS: '1',
    });
  });
});

describe('secrets under the Cursor agent', () => {
  it('never hands the agent a model-provider key but the Cursor one', async () => {
    const fake = await runTurn('hi');
    const { spawnEnv } = fake.agentLog().find((m) => m.spawnEnv)!;

    expect(spawnEnv).toMatchObject({
      CURSOR_API_KEY: CURSOR_KEY,
      GITLAB_TOKEN,
    });
    expect(spawnEnv?.OPENAI_API_KEY).toBeUndefined();
    expect(spawnEnv?.CUSTOM_PROVIDER_KEY).toBeUndefined();
  });

  it('redacts the values of secret variables from tool output, live and persisted', async () => {
    const fake = await runTurn('[envtool] show env');
    const everything = JSON.stringify([...fake.persisted, ...fake.live]);

    expect(everything).toContain('Run env');
    expect(everything).not.toContain(CURSOR_KEY);
    expect(everything).not.toContain(GITLAB_TOKEN);
    expect(everything).toContain('[redacted]');
  });

  it('redacts a secret the agent says back in its reply', async () => {
    const fake = await runTurn(`my key is ${CURSOR_KEY}`);
    const everything = JSON.stringify([...fake.persisted, ...fake.live]);

    expect(everything).toContain('reply: my key is');
    // The user's own prompt is theirs to see; only the agent's output is masked.
    const output = [...fake.persisted, ...fake.live].filter(
      (e) => e.role === 'assistant',
    );
    expect(JSON.stringify(output)).not.toContain(CURSOR_KEY);
  });

  it('masks the final reply handed to the chat completion callback', async () => {
    const fake = await runTurn(`my key is ${CURSOR_KEY}`);

    expect(fake.turnCompleted).toHaveLength(1);
    expect(fake.turnCompleted[0]!.text).toContain('reply: my key is');
    expect(fake.turnCompleted[0]!.text).not.toContain(CURSOR_KEY);
    expect(fake.turnCompleted[0]!.text).toContain('[redacted]');
  });

  it('masks a secret split across streamed chunks, even in the live stream', async () => {
    const fake = await runTurn(`key ${GITLAB_TOKEN} end`, {
      FAKE_ACP_CHUNK_SIZE: '7',
    });
    const chunks = fake.live.filter((e) =>
      e.eventType.endsWith('assistant_message_chunk'),
    );
    const streamed = chunks.map((e) => e.text).join('');

    expect(chunks.length).toBeGreaterThan(0);
    expect(streamed).toBe('reply: key [redacted] end');
    expect(JSON.stringify(agentOutput(fake))).not.toContain(GITLAB_TOKEN);
  });

  it('masks a secret echoed in a plan entry', async () => {
    const fake = await runTurn(`[plan] use ${GITLAB_TOKEN}`);
    const everything = JSON.stringify(agentOutput(fake));

    expect(everything).toContain('plan: use [redacted]');
    expect(everything).not.toContain(GITLAB_TOKEN);
  });

  it('masks a secret in the terminal error that ends a task', async () => {
    const fake = await startFakeCursorHarness({
      env: {
        GITLAB_TOKEN,
        FAKE_ACP_FAIL_NEW: JSON.stringify({ message: `bad ${GITLAB_TOKEN}` }),
      },
    });
    live.push(fake);
    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskAborted'));

    expect(JSON.stringify(fake.taskEvents)).toContain('[redacted]');
    expect(JSON.stringify(fake.taskEvents)).not.toContain(GITLAB_TOKEN);
  });
});

describe('the agent stderr in the harness log', () => {
  it('has the values of secret variables masked', async () => {
    const lines: string[] = [];
    const record = (...args: unknown[]) => void lines.push(args.join(' '));
    const fake = await startFakeCursorHarness({
      env: { GITLAB_TOKEN, FAKE_ACP_STDERR_ENV: 'GITLAB_TOKEN' },
      start: {
        logger: {
          runId: 1,
          filePath: '/dev/null',
          log: record,
          info: record,
          warn: record,
          error: record,
        },
      },
    });
    live.push(fake);
    fake.harness.sendCommand(startTask('hi'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));
    await waitFor(() => lines.some((l) => l.includes('bad credential')));

    expect(lines.join('\n')).toContain('bad credential [redacted]');
    expect(lines.join('\n')).not.toContain(GITLAB_TOKEN);
  });
});

describe('a secret that reaches the task after the agent started', () => {
  const LATE_SECRET = 'added-mid-task-secret-value-5';

  it('is masked in the reply, live and persisted, once the harness is told of it', async () => {
    const fake = await startFakeCursorHarness({ env: { GITLAB_TOKEN } });
    live.push(fake);
    fake.harness.addSecretValues?.([LATE_SECRET]);
    fake.harness.sendCommand(startTask(`late ${LATE_SECRET} end`));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(JSON.stringify(agentOutput(fake))).toContain(
      'reply: late [redacted]',
    );
    expect(JSON.stringify(agentOutput(fake))).not.toContain(LATE_SECRET);
    expect(fake.turnCompleted[0]!.text).not.toContain(LATE_SECRET);
  });

  it('is masked when it arrives in the middle of a turn, even across chunks', async () => {
    const fake = await startFakeCursorHarness({
      env: { FAKE_ACP_CHUNK_SIZE: '6', FAKE_ACP_PROMPT_DELAY_MS: '200' },
    });
    live.push(fake);
    fake.harness.sendCommand(startTask(`before ${LATE_SECRET} after`));
    fake.harness.addSecretValues?.([LATE_SECRET]);
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    const streamed = fake.live
      .filter((e) => e.eventType.endsWith('assistant_message_chunk'))
      .map((e) => e.text)
      .join('');
    expect(streamed).not.toContain(LATE_SECRET);
    expect(JSON.stringify(agentOutput(fake))).not.toContain(LATE_SECRET);
  });

  it('is masked in the agent stderr log', async () => {
    const lines: string[] = [];
    const record = (...args: unknown[]) => void lines.push(args.join(' '));
    const fake = await startFakeCursorHarness({
      start: {
        logger: {
          runId: 1,
          filePath: '/dev/null',
          log: record,
          info: record,
          warn: record,
          error: record,
        },
      },
    });
    live.push(fake);
    fake.harness.addSecretValues?.([LATE_SECRET]);
    fake.harness.sendCommand(startTask(`[stderr] key ${LATE_SECRET}`));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));
    await waitFor(() => lines.some((l) => l.includes('warning: key')));

    expect(lines.join('\n')).toContain('warning: key [redacted]');
    expect(lines.join('\n')).not.toContain(LATE_SECRET);
  });
});
