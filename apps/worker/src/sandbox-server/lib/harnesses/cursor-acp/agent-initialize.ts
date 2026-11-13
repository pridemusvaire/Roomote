import type { AcpConnection } from './acp-connection';

/** ACP `initialize`: no client-side fs or terminal, the agent has its own. */
export async function initializeAgent(
  connection: AcpConnection,
): Promise<void> {
  await connection.request(
    'initialize',
    {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    },
    { timeoutMs: 30_000 },
  );
}
