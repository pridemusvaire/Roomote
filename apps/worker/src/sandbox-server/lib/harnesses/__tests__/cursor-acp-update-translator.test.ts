import { UpdateTranslator } from '../cursor-acp/update-translator';

function setup() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const emitter = new Proxy(
    {},
    {
      get: (_target, name: string) => (args: Record<string, unknown>) =>
        calls.push({ name, args }),
    },
  );
  const translator = new UpdateTranslator(emitter as never);
  translator.beginTurn('sess-1', 'turn-1');
  const names = () => calls.map((call) => call.name);
  const named = (name: string) => calls.filter((call) => call.name === name);

  return { translator, calls, names, named };
}

describe('UpdateTranslator', () => {
  it('streams message and thought chunks live and flushes them as consolidated envelopes', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'hmm ' },
    });
    translator.handle({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'ok' },
    });
    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello ' },
    });
    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'world' },
    });
    const finalText = translator.flush();

    expect(finalText).toBe('Hello world');
    expect(named('assistantThoughtChunk').map((c) => c.args.text)).toEqual([
      'hmm ',
      'ok',
    ]);
    expect(named('assistantMessageChunk')).toHaveLength(2);
    expect(named('assistantThought')[0]!.args).toMatchObject({
      text: 'hmm ok',
      hadDelta: true,
    });
    expect(named('assistantMessage')[0]!.args).toMatchObject({
      sessionId: 'sess-1',
      text: 'Hello world',
      hadDelta: true,
    });
    // Live chunks and the consolidated envelope share one message identity.
    expect(named('assistantMessage')[0]!.args.messageId).toBe(
      named('assistantMessageChunk')[0]!.args.messageId,
    );
  });

  it('flushes accumulated text before a tool call so persisted order matches the stream', () => {
    const { translator, names } = setup();

    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Looking.' },
    });
    translator.handle({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'ls',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'ls' },
    });
    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Done.' },
    });

    expect(translator.flush()).toBe('Done.');
    expect(names()).toEqual([
      'assistantMessageChunk',
      'assistantMessage',
      'toolCall',
      'assistantMessageChunk',
      'assistantMessage',
    ]);
  });

  it('gives each flushed segment a distinct message id', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'a' },
    });
    translator.flush();
    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'b' },
    });
    translator.flush();

    const [first, second] = named('assistantMessage');
    expect(first!.args.messageId).not.toBe(second!.args.messageId);
  });

  it('maps a tool call and its completed update to toolCall, toolUpdate and toolResult', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Run ls',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'ls -la' },
    });
    translator.handle({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      rawOutput: { exitCode: 0, stdout: 'a.txt\n', stderr: 'warn' },
    });

    const call = named('toolCall')[0]!.args;
    expect(call).toMatchObject({
      toolCallId: 't1',
      title: 'Run ls',
      status: 'in_progress',
      contentText: 'ls -la',
    });
    expect(call.payload).toMatchObject({
      kind: 'execute',
      isExecute: true,
      command: 'ls -la',
      rawInput: { command: 'ls -la' },
    });
    const result = named('toolResult')[0]!.args;
    expect(result).toMatchObject({ toolCallId: 't1', status: 'completed' });
    expect(result.output).toContain('a.txt');
    expect(result.output).toContain('warn');
    expect(result.payload).toMatchObject({ exitCode: 0 });
    expect(named('toolUpdate').at(-1)!.args.status).toBe('completed');
  });

  it('keeps in-progress updates as updates only and merges later fields', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read',
      kind: 'read',
      status: 'pending',
    });
    translator.handle({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
      title: 'Read file.ts',
    });

    expect(named('toolResult')).toHaveLength(0);
    expect(named('toolUpdate')[0]!.args).toMatchObject({
      status: 'in_progress',
      toolName: 'Read file.ts',
    });
  });

  it('reports a failed tool with an error and falls back to stderr', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Run',
      kind: 'execute',
      status: 'pending',
    });
    translator.handle({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'failed',
      rawOutput: { exitCode: 2, stdout: '', stderr: 'boom' },
    });

    expect(named('toolResult')[0]!.args).toMatchObject({
      status: 'failed',
      output: expect.stringContaining('boom'),
    });
    expect(named('toolUpdate').at(-1)!.args.error).toContain('boom');
  });

  it('renders diff content as text', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Edit',
      kind: 'edit',
      status: 'pending',
    });
    translator.handle({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [
        { type: 'diff', path: 'src/a.ts', oldText: 'one', newText: 'two' },
      ],
    });

    const output = named('toolResult')[0]!.args.output as string;
    expect(output).toContain('src/a.ts');
    expect(output).toContain('one');
    expect(output).toContain('two');
  });

  it('creates the tool call when an update arrives for an unknown id', () => {
    const { translator, names } = setup();

    translator.handle({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'late',
      status: 'completed',
      title: 'x',
    });

    expect(names()).toEqual(['toolCall', 'toolUpdate', 'toolResult']);
  });

  it('maps plan updates to plan entries', () => {
    const { translator, named } = setup();

    translator.handle({
      sessionUpdate: 'plan',
      entries: [
        { content: 'a', priority: 'high', status: 'completed' },
        { content: 'b', priority: 'low', status: 'pending' },
      ],
    });

    expect(named('plan')[0]!.args.entries).toEqual([
      { id: 'plan-0', content: 'a', priority: 'high', status: 'completed' },
      { id: 'plan-1', content: 'b', priority: 'low', status: 'pending' },
    ]);
  });

  it('ignores metadata updates and updates outside a turn', () => {
    const { translator, calls } = setup();

    translator.handle({ sessionUpdate: 'session_info_update', title: 't' });
    translator.handle({ sessionUpdate: 'available_commands_update' });
    translator.handle({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'replayed' },
    });
    translator.endTurn();
    translator.handle({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'late' },
    });

    expect(calls).toHaveLength(0);
  });

  it('flush on an empty turn emits nothing and returns an empty string', () => {
    const { translator, calls } = setup();

    expect(translator.flush()).toBe('');
    expect(calls).toHaveLength(0);
  });
});
