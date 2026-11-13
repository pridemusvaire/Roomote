import { PassThrough } from 'node:stream';

import { AcpConnection, AcpRpcError } from '../cursor-acp/acp-connection';

function setup() {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const connection = new AcpConnection(toAgent, fromAgent);
  const sent: Array<Record<string, unknown>> = [];

  toAgent.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) sent.push(JSON.parse(line));
    }
  });

  const agentSays = (message: unknown) =>
    fromAgent.write(`${JSON.stringify(message)}\n`);
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  return { connection, sent, agentSays, fromAgent, tick };
}

describe('AcpConnection', () => {
  it('sends line-delimited JSON-RPC requests and resolves with the result', async () => {
    const { connection, sent, agentSays, tick } = setup();
    const pending = connection.request('initialize', { protocolVersion: 1 });
    await tick();

    expect(sent[0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: 1 },
    });
    agentSays({ jsonrpc: '2.0', id: sent[0]!.id, result: { ok: true } });

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects with an AcpRpcError carrying code and message', async () => {
    const { connection, sent, agentSays, tick } = setup();
    const pending = connection.request('session/set_model', {});
    await tick();
    agentSays({
      jsonrpc: '2.0',
      id: sent[0]!.id,
      error: { code: -32602, message: 'Invalid model value' },
    });

    await expect(pending).rejects.toMatchObject({
      name: 'AcpRpcError',
      code: -32602,
      message: 'Invalid model value',
    });
    await expect(pending).rejects.toBeInstanceOf(AcpRpcError);
  });

  it('ignores non-JSON lines and keeps parsing', async () => {
    const { connection, sent, agentSays, fromAgent, tick } = setup();
    const pending = connection.request('x', {});
    await tick();
    fromAgent.write('Warning: not json\n');
    agentSays({ jsonrpc: '2.0', id: sent[0]!.id, result: 1 });

    await expect(pending).resolves.toBe(1);
  });

  it('dispatches notifications to handlers', async () => {
    const { connection, agentSays, tick } = setup();
    const handler = vi.fn();
    connection.onNotification('session/update', handler);
    agentSays({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { update: { sessionUpdate: 'agent_message_chunk' } },
    });
    await tick();

    expect(handler).toHaveBeenCalledWith({
      update: { sessionUpdate: 'agent_message_chunk' },
    });
  });

  it('answers agent requests with the handler result', async () => {
    const { connection, sent, agentSays, tick } = setup();
    connection.onRequest('session/request_permission', async () => ({
      outcome: 'ok',
    }));
    agentSays({
      jsonrpc: '2.0',
      id: 7,
      method: 'session/request_permission',
      params: {},
    });
    await tick();
    await tick();

    expect(sent).toContainEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { outcome: 'ok' },
    });
  });

  it('answers unknown agent requests with method-not-found', async () => {
    const { sent, agentSays, tick } = setup();
    agentSays({ jsonrpc: '2.0', id: 9, method: 'fs/read_text_file' });
    await tick();

    expect(sent[0]).toMatchObject({ id: 9, error: { code: -32601 } });
  });

  it('answers with an error when a request handler throws', async () => {
    const { connection, sent, agentSays, tick } = setup();
    connection.onRequest('boom', async () => {
      throw new Error('handler failed');
    });
    agentSays({ jsonrpc: '2.0', id: 3, method: 'boom' });
    await tick();
    await tick();

    expect(sent[0]).toMatchObject({
      id: 3,
      error: { code: -32603, message: 'handler failed' },
    });
  });

  it('sends notifications without an id', async () => {
    const { connection, sent, tick } = setup();
    connection.notify('session/cancel', { sessionId: 's' });
    await tick();

    expect(sent[0]).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 's' },
    });
  });

  it('rejects a request that exceeds timeoutMs', async () => {
    const { connection } = setup();

    await expect(
      connection.request('slow', {}, { timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/);
  });

  it('rejects all pending requests and notifies listeners on close', async () => {
    const { connection } = setup();
    const onClose = vi.fn();
    connection.onClose(onClose);
    const pending = connection.request('x', {});

    connection.close();

    await expect(pending).rejects.toThrow(/closed/);
    expect(onClose).toHaveBeenCalledTimes(1);
    await expect(connection.request('y', {})).rejects.toThrow(/closed/);
  });

  it('closes when the agent stdout ends', async () => {
    const { connection, fromAgent, tick } = setup();
    const onClose = vi.fn();
    connection.onClose(onClose);
    const rejected = expect(connection.request('x', {})).rejects.toThrow(
      /closed/,
    );

    fromAgent.end();
    await tick();

    await rejected;
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports activity for every inbound message', async () => {
    const { connection, agentSays, tick } = setup();
    const activity = vi.fn();
    connection.onActivity(activity);
    agentSays({ jsonrpc: '2.0', method: 'noise', params: {} });
    await tick();

    expect(activity).toHaveBeenCalledTimes(1);
  });
});
