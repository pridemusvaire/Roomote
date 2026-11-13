import type { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';

import type { AcpSessionUpdate } from './acp-types';
import { toPlanTodos } from './plan-todos';
import { TextSegments } from './text-segments';
import { TurnActivity } from './turn-activity';
import { ToolCallTranslator } from './tool-call-translator';

type TranslatorEmitter = ConstructorParameters<typeof TextSegments>[0] &
  ConstructorParameters<typeof ToolCallTranslator>[0] &
  Pick<OpenCodeRuntimeEventEmitter, 'plan'>;

/**
 * Maps ACP `session/update` notifications of one turn onto Roomote runtime
 * envelopes. A text segment ends at every tool call or plan so the persisted
 * order matches the stream. Updates outside a turn (such as the history
 * `session/load` replays) are dropped.
 */
export class UpdateTranslator {
  private sessionId = '';
  private active = false;
  /** What the agent has produced this turn. */
  readonly activity = new TurnActivity();
  private readonly text: TextSegments;
  private readonly tools: ToolCallTranslator;

  constructor(
    private readonly emitter: TranslatorEmitter,
    mcpServers: readonly { name: string }[] = [],
  ) {
    this.text = new TextSegments(emitter);
    this.tools = new ToolCallTranslator(
      emitter,
      mcpServers.map((server) => server.name),
    );
  }

  beginTurn(sessionId: string, turnId: string): void {
    this.sessionId = sessionId;
    this.active = true;
    this.text.begin(sessionId, turnId);
    this.tools.reset();
  }

  endTurn(): void {
    this.active = false;
  }

  /** A command is running; the agent is silent while it does. */
  hasRunningTools(): boolean {
    return this.tools.hasRunningTools();
  }

  flush(): string {
    return this.text.flush();
  }

  /**
   * `sessionId` is the session the agent tagged the update with. An update for
   * another session is a leftover of one this turn abandoned.
   */
  handle(update: AcpSessionUpdate, sessionId?: string): void {
    if (!this.active || (sessionId && sessionId !== this.sessionId)) {
      return;
    }

    this.activity.note(update.sessionUpdate);

    const text = Array.isArray(update.content)
      ? ''
      : (update.content?.text ?? '');

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.text.addMessage(text);
        return;
      case 'agent_thought_chunk':
        this.text.addThought(text);
        return;
      case 'tool_call':
      case 'tool_call_update':
        this.text.flush();
        this.tools.handle(update, this.base());
        return;
      case 'plan':
        this.text.flush();
        this.emitter.plan({
          ...this.base(),
          entries: toPlanTodos(update.entries),
        });
        return;
      default:
        return;
    }
  }

  private base() {
    return { sessionId: this.sessionId, messageId: this.text.messageId() };
  }
}
