import { buildEngineHandoffInstructions } from './engine-handoff';
import { buildEngineSwitchNote } from './engine-switch-note';

describe('buildEngineSwitchNote', () => {
  it('names both engines, in either direction', () => {
    expect(buildEngineSwitchNote('cursor-acp', 'opencode-server')).toContain(
      'switched from Cursor to OpenCode',
    );
    expect(buildEngineSwitchNote('opencode-server', 'cursor-acp')).toContain(
      'switched from OpenCode to Cursor',
    );
    expect(buildEngineSwitchNote('cursor-acp', 'opencode-server')).toContain(
      'earlier tool context may be missing',
    );
  });
});

describe('buildEngineHandoffInstructions', () => {
  const turns = [
    { role: 'user', text: 'first ask' },
    { role: 'assistant', text: 'did part one' },
    { role: 'user', text: 'now finish the migration' },
    { role: 'assistant', text: 'started it' },
  ] as const;

  it.each(['cursor-acp', 'opencode-server'] as const)(
    'carries the latest request verbatim and a short history from %s',
    (from) => {
      const text = buildEngineHandoffInstructions(from, turns)!;

      expect(text).toContain(
        from === 'cursor-acp' ? 'running on Cursor' : 'running on OpenCode',
      );
      expect(text).toContain('- User: first ask');
      expect(text).toContain('- Assistant: did part one');
      expect(text).toContain(
        "## The user's latest request (verbatim)\nnow finish the migration",
      );
      expect(text).toContain(
        '## What you already replied\n- Assistant: started it',
      );
    },
  );

  it('keeps the latest request whole and clips long history', () => {
    const long = 'x'.repeat(5_000);
    const text = buildEngineHandoffInstructions('cursor-acp', [
      { role: 'assistant', text: long },
      { role: 'user', text: long },
    ])!;

    expect(text).toContain(long);
    expect(text).toContain(`…${'x'.repeat(599)}`);
    expect(text).not.toContain('x'.repeat(601) + '\n');
  });

  it('keeps the request and a bounded reply when one long assistant turn followed it', () => {
    const reply = 'z'.repeat(8_000);
    const text = buildEngineHandoffInstructions('cursor-acp', [
      { role: 'user', text: 'refactor the parser' },
      { role: 'assistant', text: reply },
    ])!;

    expect(text).toContain(
      "## The user's latest request (verbatim)\nrefactor the parser",
    );
    expect(text).toContain('## What you already replied');
    expect(text).not.toContain('z'.repeat(601));
  });

  it('keeps the latest text of a long assistant reply, not its oldest', () => {
    const reply = `OLDEST ${'z'.repeat(8_000)} NEWEST`;
    const text = buildEngineHandoffInstructions('cursor-acp', [
      { role: 'user', text: 'refactor the parser' },
      { role: 'assistant', text: reply },
    ])!;

    expect(text).toContain('- Assistant: …');
    expect(text).toContain('NEWEST');
    expect(text).not.toContain('OLDEST');
  });

  it('keeps the latest text of long assistant history too', () => {
    const text = buildEngineHandoffInstructions('cursor-acp', [
      { role: 'assistant', text: `OLDEST ${'z'.repeat(2_000)} NEWEST` },
      { role: 'user', text: 'now this' },
    ])!;

    expect(text).toContain('NEWEST');
    expect(text).not.toContain('OLDEST');
  });

  it('has nothing to carry without a user turn', () => {
    expect(buildEngineHandoffInstructions('cursor-acp', [])).toBeUndefined();
    expect(
      buildEngineHandoffInstructions('cursor-acp', [
        { role: 'assistant', text: 'hi' },
      ]),
    ).toBeUndefined();
  });

  describe('with a replayed prompt that is not persisted yet', () => {
    it('makes the replayed prompt the current request and every persisted turn history', () => {
      const text = buildEngineHandoffInstructions('cursor-acp', turns, {
        text: 'the prompt that never ran',
      })!;

      expect(text).toContain(
        "## The user's latest request (verbatim)\nthe prompt that never ran",
      );
      expect(text).toContain('- User: now finish the migration');
      expect(text).toContain('- Assistant: started it');
      expect(text).not.toContain('## What you already replied');
    });

    it('keeps the persisted latest request when the replay is that very prompt', () => {
      const text = buildEngineHandoffInstructions('cursor-acp', turns, {
        text: '  now finish the migration ',
      })!;

      expect(text).toContain('- User: first ask');
      expect(text).toContain(
        "## The user's latest request (verbatim)\nnow finish the migration",
      );
      expect(text).toContain(
        '## What you already replied\n- Assistant: started it',
      );
      expect(text).not.toContain('- User: now finish the migration');
    });

    it('keeps the last persisted user turn as the request when the replay is hidden', () => {
      const text = buildEngineHandoffInstructions('cursor-acp', turns, {
        text: 'Post your closing reply now.',
        hidden: true,
      })!;

      expect(text).toContain(
        "## The user's latest request (verbatim)\nnow finish the migration",
      );
      expect(text).toContain(
        '## What you already replied\n- Assistant: started it',
      );
      expect(text).toContain(
        '## Instruction for this turn (not from the user)\nPost your closing reply now.',
      );
      expect(text).not.toContain(
        'latest request (verbatim)\nPost your closing reply now.',
      );
    });

    it('does not repeat a hidden replay that is already the persisted request', () => {
      const text = buildEngineHandoffInstructions('cursor-acp', turns, {
        text: 'now finish the migration',
        hidden: true,
      })!;

      expect(text).not.toContain('Instruction for this turn');
    });

    it('has nothing to carry when there is no history at all', () => {
      expect(
        buildEngineHandoffInstructions('cursor-acp', [], { text: 'brand new' }),
      ).toBeUndefined();
    });
  });
});
