import { extractAcpMcpInvocation } from '@roomote/types';

import { ReconnectableHarness } from '../../../../run-task/reconnectable-harness';
import {
  startFakeCursorHarness,
  startTask,
  waitFor,
} from './cursor-acp-test-harness';

const mcpServers = {
  roomote: { type: 'stdio', command: 'node', args: ['roomote.js'] },
};

async function runTurn(prompt: string) {
  const fake = await startFakeCursorHarness({ start: { mcpServers } });
  fake.harness.sendCommand(startTask(prompt));
  await waitFor(() => fake.timeline.includes('task:taskCompleted'));
  return fake;
}

const toolResult = (fake: Awaited<ReturnType<typeof runTurn>>) =>
  fake.persisted.find((e) => e.eventType === 'roomote_runtime.tool_result')!;

describe('Cursor MCP tool calls', () => {
  it('carry the same MCP identity the OpenCode harness writes', async () => {
    const fake = await runTurn('[mcp] reply');
    const identity = {
      kind: 'mcp',
      isMcp: true,
      mcpServerName: 'roomote',
      mcpToolName: 'reply_to_slack_thread',
      serverName: 'roomote',
      toolName: 'reply_to_slack_thread',
      isExecute: false,
      flattenedServerNames: ['roomote'],
      // What the tool was called with, not the ACP wrapper around it.
      rawInput: { text: 'hello from composer' },
    };
    const calls = fake.persisted.filter(
      (e) => e.eventType === 'roomote_runtime.tool_call',
    );

    // The call opens as an anonymous stub; it is announced once an update
    // names it, so the persisted call never shows a generic title.
    expect(calls).toHaveLength(1);
    for (const envelope of [...calls, toolResult(fake)]) {
      expect(envelope.payload).toMatchObject(identity);
    }
    expect(toolResult(fake).payload).toMatchObject({
      status: 'completed',
      output: '{"success":true}',
    });
    expect(extractAcpMcpInvocation(toolResult(fake).payload)).toEqual({
      mcpServerName: 'roomote',
      mcpToolName: 'reply_to_slack_thread',
    });
    fake.dispose();
  });

  it('is seen by the worker reply tracking (pending env var request)', async () => {
    const fake = await startFakeCursorHarness({ start: { mcpServers } });
    const reconnectable = new ReconnectableHarness({
      logger: { info() {}, warn() {}, error() {}, log() {} } as never,
      spawnHarness: async () => ({
        harness: fake.harness,
        subprocess: fake.subprocess,
      }),
    });
    await reconnectable.start();

    reconnectable.sendCommand(startTask('[mcpenv] need a key'));
    await waitFor(() => reconnectable.getPendingEnvVarRequest() !== null);

    expect(reconnectable.getPendingEnvVarRequest()?.variables).toEqual([
      { name: 'STRIPE_KEY' },
    ]);
    reconnectable.dispose();
    fake.dispose();
  });

  it('leaves native tools, and unconfigured servers, untagged', async () => {
    const fake = await startFakeCursorHarness();
    fake.harness.sendCommand(startTask('[mcp] reply'));
    await waitFor(() => fake.timeline.includes('task:taskCompleted'));

    expect(toolResult(fake).payload).toMatchObject({
      isMcp: false,
      mcpServerName: null,
      mcpToolName: null,
    });
    fake.dispose();
  });
});
