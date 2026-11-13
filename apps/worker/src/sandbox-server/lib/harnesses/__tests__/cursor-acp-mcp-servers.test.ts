import { toAcpMcpServers } from '../cursor-acp/mcp-servers';

describe('toAcpMcpServers', () => {
  it('maps stdio servers to name/command/args/env entries', () => {
    expect(
      toAcpMcpServers({
        roomote: {
          type: 'stdio',
          command: 'node',
          args: ['server.js', '--flag'],
          env: { TOKEN: 'abc' },
        },
      }),
    ).toEqual([
      {
        name: 'roomote',
        command: 'node',
        args: ['server.js', '--flag'],
        env: [{ name: 'TOKEN', value: 'abc' }],
      },
    ]);
  });

  it('maps streamable-http servers to http entries with header lists', () => {
    expect(
      toAcpMcpServers({
        remote: {
          type: 'streamable-http',
          url: 'https://mcp.example.test/mcp',
          headers: { Authorization: 'Bearer t' },
        },
      }),
    ).toEqual([
      {
        type: 'http',
        name: 'remote',
        url: 'https://mcp.example.test/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer t' }],
      },
    ]);
  });

  it('drops configs it cannot parse and reports them through the callback', () => {
    const skipped: string[] = [];

    expect(
      toAcpMcpServers(
        {
          weird: { type: 'carrier-pigeon' },
          ok: { type: 'stdio', command: 'x' },
        },
        (name) => skipped.push(name),
      ),
    ).toEqual([{ name: 'ok', command: 'x', args: [], env: [] }]);
    expect(skipped).toEqual(['weird']);
  });

  it('returns an empty list for no servers', () => {
    expect(toAcpMcpServers({})).toEqual([]);
  });
});
