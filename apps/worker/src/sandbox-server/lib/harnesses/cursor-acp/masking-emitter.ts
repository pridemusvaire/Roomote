import type { AcpMessage, TaskEvent } from '@roomote/types';

import { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';
import type { PersistableEnvelope } from '../../runtime-envelope-builder';

import { ChunkStreamMasker } from './chunk-stream-masker';
import { maskDeep, type SecretSet } from './secret-mask';

type Emitter = OpenCodeRuntimeEventEmitter;
type Chunk = Parameters<Emitter['assistantMessageChunk']>[0];

/**
 * The runtime emitter, with the exact values of the task's secret variables
 * masked out of everything the agent produces. The user's own prompt is not
 * touched.
 *
 * Masking sits on the four sinks every event leaves through, so no emitter
 * method (a reply, a plan, a turn's final text, a terminal error) can bypass
 * it. Only the live text chunks need more: see `ChunkStreamMasker`.
 */
export class MaskingEventEmitter extends OpenCodeRuntimeEventEmitter {
  private readonly messageStream: ChunkStreamMasker<Chunk>;
  private readonly thoughtStream: ChunkStreamMasker<Chunk>;

  constructor(
    callbacks: ConstructorParameters<typeof OpenCodeRuntimeEventEmitter>[0],
    private readonly secretSet: SecretSet,
  ) {
    super(callbacks);
    this.messageStream = new ChunkStreamMasker(secretSet);
    this.thoughtStream = new ChunkStreamMasker(secretSet);
  }

  protected get secrets(): readonly string[] {
    return this.secretSet.values;
  }

  override emitOutput(event: AcpMessage): void {
    super.emitOutput(this.agentOnly(event));
  }

  override emitPersisted(envelope: PersistableEnvelope): void {
    super.emitPersisted(this.agentOnly(envelope));
  }

  override emitTurnCompleted(
    event: Parameters<Emitter['emitTurnCompleted']>[0],
  ): void {
    super.emitTurnCompleted(maskDeep(event, this.secrets));
  }

  override emitTaskEvent(event: TaskEvent): void {
    super.emitTaskEvent(maskDeep(event, this.secrets));
  }

  override assistantMessageChunk(options: Chunk): void {
    const safe = this.messageStream.push(options);
    if (safe) super.assistantMessageChunk(safe);
  }

  override assistantThoughtChunk(options: Chunk): void {
    const safe = this.thoughtStream.push(options);
    if (safe) super.assistantThoughtChunk(safe);
  }

  /** A consolidated block ends the segment: show what was held back. */
  override assistantThought(
    options: Parameters<Emitter['assistantThought']>[0],
  ): void {
    this.releaseHeldText();
    super.assistantThought(options);
  }

  override assistantMessage(
    options: Parameters<Emitter['assistantMessage']>[0],
  ): void {
    this.releaseHeldText();
    super.assistantMessage(options);
  }

  private releaseHeldText(): void {
    const thought = this.thoughtStream.end();
    const message = this.messageStream.end();
    if (thought) super.assistantThoughtChunk(thought);
    if (message) super.assistantMessageChunk(message);
  }

  /** The user's own words are theirs to see; everything else is masked. */
  private agentOnly<T extends { role: string | null }>(event: T): T {
    return event.role === 'user' ? event : maskDeep(event, this.secrets);
  }
}
