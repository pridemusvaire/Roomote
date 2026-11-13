import type {
  RegisteredTool,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { NullableOptionalsMcpServer } from '@roomote/cloud-agents/mcp-nullable-optionals';

import { guardToolInput } from './tool-secret-guard.js';
import { errorResult } from './tool-result.js';

/**
 * The Roomote MCP server, with the exact values of the task's secret
 * variables kept out of every tool's input before its handler runs. Only a
 * Cursor task is guarded (see `guardToolInput`); OpenCode tasks are not.
 *
 * Every tool that sends agent-authored text somewhere (a chat or Slack reply,
 * a report to the parent session, a pull request comment, a message to another
 * task) takes it as input, so this one choke point covers them all. Tools that
 * write text people read have the value masked; tools that store their input
 * refuse it instead (see `toolSecretPolicy`). A model that can see a raw
 * secret (the Cursor agent can: it has no output-masking hook) cannot post or
 * save it through Roomote.
 */
export class MaskingMcpServer extends NullableOptionalsMcpServer {
  override registerTool<
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotations;
      _meta?: Record<string, unknown>;
    },
    cb: ToolCallback<InputArgs>,
  ): RegisteredTool {
    // A tool without input receives only the request context: nothing to mask.
    if (!config.inputSchema) return super.registerTool(name, config, cb);

    const withInput = cb as unknown as (
      input: unknown,
      extra: unknown,
    ) => unknown;
    const guarded = (input: unknown, extra: unknown) => {
      const verdict = guardToolInput(name, input);

      return verdict.proceed
        ? withInput(verdict.input, extra)
        : errorResult(verdict.error);
    };

    return super.registerTool(name, config, guarded as unknown as typeof cb);
  }
}
