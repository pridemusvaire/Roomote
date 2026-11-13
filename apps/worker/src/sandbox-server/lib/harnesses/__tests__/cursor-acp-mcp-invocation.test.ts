import {
  mcpToolInput,
  resolveMcpInvocation,
} from '../cursor-acp/mcp-invocation';

const servers = ['roomote', 'roomote-extra', 'github'];
const call = (title: string, kind = 'other', rawInput?: unknown) =>
  resolveMcpInvocation({ kind, title, rawInput }, servers);

describe('resolveMcpInvocation', () => {
  it.each([
    ['roomote_send_chat_reply', 'roomote', 'send_chat_reply'],
    ['roomote-send_chat_reply', 'roomote', 'send_chat_reply'],
    ['roomote:send_chat_reply', 'roomote', 'send_chat_reply'],
    ['github/create_issue', 'github', 'create_issue'],
    ['mcp__github__create_issue', 'github', 'create_issue'],
    ['roomote-extra_ping', 'roomote-extra', 'ping'],
  ])('reads %s', (title, server, tool) => {
    expect(call(title)).toEqual({ mcpServerName: server, mcpToolName: tool });
  });

  it.each([
    [
      'MCP: tool',
      { providerIdentifier: 'roomote', toolName: 'reply' },
      'reply',
    ],
    ['roomote: reply', undefined, 'reply'],
    [
      'anything',
      { providerIdentifier: 'github', toolName: 'x', args: {} },
      'x',
    ],
  ])('reads the verified shape of %s', (title, rawInput, tool) => {
    expect(call(title, 'other', rawInput)).toEqual({
      mcpServerName: title === 'anything' ? 'github' : 'roomote',
      mcpToolName: tool,
    });
  });

  it('leaves the anonymous stub unresolved until an update names it', () => {
    expect(call('MCP: tool', 'other', {})).toBeNull();
  });

  it('ignores a providerIdentifier that is not a configured server', () => {
    expect(
      call('MCP: tool', 'other', { providerIdentifier: 'evil', toolName: 'x' }),
    ).toBeNull();
  });

  it('shows the args as the tool input', () => {
    expect(
      mcpToolInput({
        providerIdentifier: 'roomote',
        toolName: 't',
        args: { a: 1 },
      }),
    ).toEqual({ a: 1 });
    expect(mcpToolInput({ command: 'ls' })).toEqual({ command: 'ls' });
  });

  it.each([
    ['Run ls', 'execute', { command: 'ls' }],
    ['Read file', 'read', undefined],
    ['roomote send reply', 'other', undefined],
    ['other_send_chat_reply', 'other', undefined],
    ['roomote_', 'other', undefined],
  ])('does not take %s for an MCP call', (title, kind, rawInput) => {
    expect(call(title, kind, rawInput)).toBeNull();
  });

  it('never matches without configured servers', () => {
    expect(
      resolveMcpInvocation({ kind: 'other', title: 'roomote_x' }, []),
    ).toBeNull();
  });

  it('ignores an explicit server that is not configured', () => {
    expect(call('Fetch', 'other', { server: 'evil', tool: 'x' })).toBeNull();
  });
});
