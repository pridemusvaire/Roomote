import type { AcpSessionUpdate } from './acp-types';
import { isAnonymousMcpStub } from './mcp-stub';
import { buildToolPayload, toolCommand } from './tool-payload';
import { emitToolProgress, type ToolEmitter } from './tool-progress';
import {
  isTerminalToolStatus,
  mergeToolState,
  type ToolState,
} from './tool-state';

/** Turns `tool_call` / `tool_call_update` into tool envelopes. */
export class ToolCallTranslator {
  private readonly tools = new Map<string, ToolState>();
  /** Calls whose tool call envelope has been emitted. */
  private readonly announced = new Set<string>();

  constructor(
    private readonly emitter: ToolEmitter,
    private readonly mcpServerNames: readonly string[] = [],
  ) {}

  /** A tool call has started and not reached a final status. */
  hasRunningTools(): boolean {
    return [...this.tools.values()].some(
      (state) => !isTerminalToolStatus(state.status),
    );
  }

  reset(): void {
    this.tools.clear();
    this.announced.clear();
  }

  handle(
    update: AcpSessionUpdate,
    base: { sessionId: string; messageId: string },
  ): void {
    const id = update.toolCallId;

    if (!id) {
      return;
    }

    const state = mergeToolState(id, update, this.tools.get(id));
    this.tools.set(id, state);
    const payload = buildToolPayload(
      state,
      base.sessionId,
      this.mcpServerNames,
    );
    const terminal = isTerminalToolStatus(state.status);

    // An MCP call opens as an anonymous stub and is named by a later update.
    // Announcing it only then keeps the persisted call from showing a
    // generic title and no MCP identity.
    if (
      !this.announced.has(id) &&
      !terminal &&
      isAnonymousMcpStub(state, payload)
    ) {
      return;
    }

    if (!this.announced.has(id)) {
      this.announced.add(id);
      this.emitter.toolCall({
        ...base,
        toolCallId: id,
        title: state.title,
        status: 'in_progress',
        payload,
        contentText: toolCommand(state) ?? state.title,
      });
    }

    // A fresh `tool_call` that has not progressed yet is fully described by
    // the tool call envelope; later updates carry output and status.
    if (update.sessionUpdate === 'tool_call' && !terminal) {
      return;
    }

    emitToolProgress(this.emitter, { ...base, state, payload });
  }
}
