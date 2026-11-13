import { TaskCommandName } from '../../harness';
import {
  startFakeCursorHarness,
  startTask,
  waitFor,
} from './cursor-acp-test-harness';

type Fake = Awaited<ReturnType<typeof startFakeCursorHarness>>;

const live: Fake[] = [];
async function start(...args: Parameters<typeof startFakeCursorHarness>) {
  const fake = await startFakeCursorHarness(...args);
  live.push(fake);
  return fake;
}
afterEach(() => live.splice(0).forEach((fake) => fake.dispose()));

const idle = (fake: Fake, count = 1) =>
  waitFor(
    () =>
      fake.timeline.filter((l) => l === 'task:taskCompleted').length >= count,
  );
const prompts = (fake: Fake) =>
  fake
    .agentLog()
    .filter((m) => m.method === 'session/prompt')
    .map((m) => m.params.prompt[0]!.text);
const send = (fake: Fake, text: string) =>
  fake.harness.sendCommand({
    commandName: TaskCommandName.SendMessage,
    data: { text },
  });
const userPromptTexts = (fake: Fake) =>
  fake.persisted
    .filter((e) => e.eventType === 'roomote_runtime.user_prompt')
    .map((e) => e.payload.text);

describe('Cursor developer instructions', () => {
  const developerInstructionsContent = 'Always reply in Slack threads.';

  it('prepends them to the first prompt of a new session only', async () => {
    const fake = await start({ start: { developerInstructionsContent } });

    fake.harness.sendCommand(startTask('build it'));
    await idle(fake);
    send(fake, 'and test it');
    await idle(fake, 2);

    const [first, second] = prompts(fake);
    expect(first).toMatch(/^<roomote-instructions>\n/);
    expect(first).toContain(developerInstructionsContent);
    expect(first).toMatch(/<\/roomote-instructions>\n\nbuild it$/);
    expect(second).toBe('and test it');
  });

  it('keeps the persisted user prompt to the user text', async () => {
    const fake = await start({ start: { developerInstructionsContent } });

    fake.harness.sendCommand(startTask('build it'));
    await idle(fake);

    expect(userPromptTexts(fake)).toEqual(['build it']);
  });

  it('does not re-send them when a session is loaded', async () => {
    const fake = await start({
      start: { developerInstructionsContent, initialSessionId: 'old-session' },
    });

    send(fake, 'continue');
    await idle(fake);

    expect(prompts(fake)).toEqual(['continue']);
  });

  it('sends them again when a session could not be loaded and a new one starts', async () => {
    const fake = await start({
      env: { FAKE_ACP_FAIL_LOAD: '1' },
      start: { developerInstructionsContent, initialSessionId: 'gone' },
    });

    send(fake, 'continue');
    await idle(fake);

    expect(prompts(fake)[0]).toContain(developerInstructionsContent);
  });

  it('sends the plain prompt when there are no instructions', async () => {
    const fake = await start();

    fake.harness.sendCommand(startTask('plain'));
    await idle(fake);

    expect(prompts(fake)).toEqual(['plain']);
  });
});

describe('Cursor session/load failure', () => {
  it('warns, says so in the transcript, and continues on a new session', async () => {
    const warn = vi.fn();
    const fake = await start({
      env: { FAKE_ACP_FAIL_LOAD: '1' },
      start: {
        initialSessionId: 'gone',
        logger: {
          runId: 1,
          filePath: '/dev/null',
          log: () => {},
          info: () => {},
          warn,
          error: () => {},
        },
      },
    });

    send(fake, 'continue');
    await idle(fake);

    expect(warn).toHaveBeenCalledWith(
      '[cursor-acp]',
      expect.stringContaining('session/load failed for gone'),
    );
    const note = fake.persisted.find(
      (e) =>
        e.eventType === 'roomote_runtime.assistant_message' &&
        String(e.payload.text).includes('could not be restored'),
    );
    expect(note).toBeDefined();
    // Non-terminal: the turn still ran and the task settled normally.
    expect(prompts(fake)).toHaveLength(1);
    expect(fake.timeline).toContain('task:taskCompleted');
    expect(fake.timeline).not.toContain('task:taskAborted');
    expect(
      fake.agentLog().find((m) => m.method === 'session/prompt')!.params
        .sessionId,
    ).toBe('fake-session-1');
  });

  it('announces the replacement session so its output is not dropped', async () => {
    const fake = await start({
      env: { FAKE_ACP_FAIL_LOAD: '1' },
      start: { initialSessionId: 'gone' },
    });

    send(fake, 'continue');
    await idle(fake);

    const started = fake.taskEvents.find((e) => e.eventName === 'taskStarted');
    expect(started?.payload[0]).toBe('fake-session-1');
  });
});
