import { newPlaceholderSessionId } from '../sandbox-server/lib/harnesses/cursor-acp/placeholder-session';

import { resolveHarnessEngine, resolveSessionResume } from './harness-engine';

const CURSOR_SESSION = '3f2a9c1e-7b4d-4e8a-9f61-0c5d2a8b7e14';
const OPENCODE_SESSION = 'ses_1f2a3b4c5d6eAbCdEfGhIjKlMn';

describe('resolveHarnessEngine', () => {
  it('routes cursor models to the Cursor agent with its own model name', () => {
    expect(resolveHarnessEngine('cursor/composer-2.5')).toEqual({
      kind: 'cursor-acp',
      agentModel: 'composer-2.5',
    });
  });

  it.each([undefined, '', 'openai/gpt-5', 'xai/grok-4.7'])(
    'routes %j to OpenCode',
    (model) => {
      expect(resolveHarnessEngine(model)).toEqual({ kind: 'opencode-server' });
    },
  );
});

describe('resolveSessionResume', () => {
  const cursor = resolveHarnessEngine('cursor/composer-2.5');
  const opencode = resolveHarnessEngine('openai/gpt-5');
  const none = { sessionId: undefined, switchedFrom: undefined };

  it('keeps a session id for the engine that made it', () => {
    expect(resolveSessionResume(cursor, CURSOR_SESSION)).toEqual({
      sessionId: CURSOR_SESSION,
      switchedFrom: undefined,
    });
    expect(resolveSessionResume(opencode, OPENCODE_SESSION).sessionId).toBe(
      OPENCODE_SESSION,
    );
    expect(resolveSessionResume(opencode, 'thread-resume-123').sessionId).toBe(
      'thread-resume-123',
    );
  });

  it('drops a session id of the other engine and names where it came from', () => {
    expect(resolveSessionResume(opencode, CURSOR_SESSION)).toEqual({
      sessionId: undefined,
      switchedFrom: 'cursor-acp',
    });
    expect(resolveSessionResume(cursor, OPENCODE_SESSION)).toEqual({
      sessionId: undefined,
      switchedFrom: 'opencode-server',
    });
  });

  it('passes no session through', () => {
    expect(resolveSessionResume(cursor, undefined)).toEqual(none);
    expect(resolveSessionResume(opencode, '')).toEqual(none);
  });

  it('never resumes the id of a failed session creation, on either engine', () => {
    const placeholder = newPlaceholderSessionId();

    expect(resolveSessionResume(cursor, placeholder)).toEqual(none);
    expect(resolveSessionResume(opencode, placeholder)).toEqual(none);
  });

  it('names the previous engine when no session id says where the work came from', () => {
    const placeholder = newPlaceholderSessionId();

    expect(resolveSessionResume(opencode, undefined, 'cursor-acp')).toEqual({
      sessionId: undefined,
      switchedFrom: 'cursor-acp',
    });
    expect(resolveSessionResume(opencode, placeholder, 'cursor-acp')).toEqual({
      sessionId: undefined,
      switchedFrom: 'cursor-acp',
    });
    expect(resolveSessionResume(cursor, undefined, 'opencode-server')).toEqual({
      sessionId: undefined,
      switchedFrom: 'opencode-server',
    });
  });

  it('is no switch when the previous engine is the same, or unknown', () => {
    expect(resolveSessionResume(cursor, undefined, 'cursor-acp')).toEqual(none);
    expect(resolveSessionResume(opencode, undefined)).toEqual(none);
  });
});
