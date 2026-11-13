import type { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';

type TextEmitter = Pick<
  OpenCodeRuntimeEventEmitter,
  | 'assistantMessageChunk'
  | 'assistantThoughtChunk'
  | 'assistantMessage'
  | 'assistantThought'
>;

/**
 * Buffers streamed message and thought text. Chunks go out live as they
 * arrive; `flush` persists them as one consolidated envelope per segment.
 * Each segment has its own message id so envelopes of one turn never share a
 * logical event id.
 */
export class TextSegments {
  private sessionId = '';
  private turnId = '';
  private segment = 0;
  private message = '';
  private thought = '';
  private lastMessageText = '';

  constructor(private readonly emitter: TextEmitter) {}

  begin(sessionId: string, turnId: string): void {
    this.sessionId = sessionId;
    this.turnId = turnId;
    this.segment = 0;
    this.message = '';
    this.thought = '';
    this.lastMessageText = '';
  }

  messageId(): string {
    return `${this.turnId}:${this.segment}`;
  }

  addMessage(text: string): void {
    this.message += text;
    this.emitter.assistantMessageChunk(this.chunk(text));
  }

  addThought(text: string): void {
    this.thought += text;
    this.emitter.assistantThoughtChunk(this.chunk(text));
  }

  /** Persists buffered text; returns the turn's last non-empty message. */
  flush(): string {
    const { message, thought } = this;
    const base = { sessionId: this.sessionId, messageId: this.messageId() };

    if (thought.length > 0) {
      this.emitter.assistantThought({ ...base, text: thought, hadDelta: true });
    }

    if (message.length > 0) {
      this.lastMessageText = message;
      this.emitter.assistantMessage({ ...base, text: message, hadDelta: true });
    }

    if (thought.length > 0 || message.length > 0) {
      this.segment += 1;
      this.message = '';
      this.thought = '';
    }

    return this.lastMessageText;
  }

  private chunk(text: string) {
    return { sessionId: this.sessionId, messageId: this.messageId(), text };
  }
}
