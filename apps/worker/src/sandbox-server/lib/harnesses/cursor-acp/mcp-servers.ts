import { parseDirectMcpConfig } from '../opencode-server/mcp-config';

import type { AcpMcpServer } from './acp-types';

const toPairs = (record: Record<string, string>) =>
  Object.entries(record).map(([name, value]) => ({ name, value }));

/**
 * Maps Roomote's resolved MCP server configs onto the ACP `McpServer[]`
 * passed to `session/new`. Values arrive already substituted, so they pass
 * through verbatim (ACP has no env interpolation).
 */
export function toAcpMcpServers(
  mcpServers: Record<string, unknown>,
  onSkipped?: (name: string) => void,
): AcpMcpServer[] {
  return Object.entries(mcpServers).flatMap(([name, raw]): AcpMcpServer[] => {
    const config = parseDirectMcpConfig(raw);

    if (!config) {
      onSkipped?.(name);
      return [];
    }

    return config.type === 'stdio'
      ? [
          {
            name,
            command: config.command,
            args: config.args,
            env: toPairs(config.env),
          },
        ]
      : [
          {
            type: 'http',
            name,
            url: config.url,
            headers: toPairs(config.headers),
          },
        ];
  });
}
