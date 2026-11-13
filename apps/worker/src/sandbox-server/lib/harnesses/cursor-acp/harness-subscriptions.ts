import EventEmitter from 'node:events';

import type {
  AcpMessage,
  AcpPersistedEnvelope,
  AcpTurnCompletedEvent,
  TaskEvent,
} from '@roomote/types';

import type { HarnessCommandError, HarnessEvents } from '../../harness';

/** The `subscribe*` half of the Harness contract: thin event-emitter sugar. */
export abstract class CursorHarnessSubscriptions extends EventEmitter<HarnessEvents> {
  subscribe(listener: (event: TaskEvent) => void): () => void {
    return this.listen('taskEvent', listener);
  }

  subscribeRuntimeOutput(listener: (event: AcpMessage) => void): () => void {
    return this.listen('runtimeOutput', listener);
  }

  subscribeRuntimePersistedEnvelope(
    listener: (envelope: AcpPersistedEnvelope) => void,
  ): () => void {
    return this.listen('runtimePersistedEnvelope', listener);
  }

  subscribeRuntimeTurnCompleted(
    listener: (event: AcpTurnCompletedEvent) => void,
  ): () => void {
    return this.listen('runtimeTurnCompleted', listener);
  }

  subscribeCommandError(
    listener: (error: HarnessCommandError) => void,
  ): () => void {
    return this.listen('commandError', listener);
  }

  private listen<K extends keyof HarnessEvents>(
    name: K,
    listener: (...args: HarnessEvents[K]) => void,
  ): () => void {
    this.on(name, listener as never);
    return () => this.off(name, listener as never);
  }
}
