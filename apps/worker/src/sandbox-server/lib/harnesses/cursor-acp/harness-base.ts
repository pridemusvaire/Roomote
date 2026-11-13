import type {
  Harness,
  HarnessQueuedMessage,
  QueuedPromptMessageSnapshot,
} from '../../harness';
import { RuntimePromptQueue } from '../runtime-prompt-queue';

import { CursorHarnessSubscriptions } from './harness-subscriptions';
import { visibleQueuedMessages } from './queued-messages';
import { RedactingEventEmitter } from './redacting-emitter';
import type { SecretSet } from './secret-mask';

/**
 * State and read-only accessors shared by the command handlers. Holds no
 * protocol logic.
 */
export abstract class CursorHarnessBase
  extends CursorHarnessSubscriptions
  implements Pick<Harness, 'supportsNativeTurnSteering'>
{
  protected connected = false;
  protected disposed = false;
  private commandEnv: Record<string, string> = {};

  protected readonly events: RedactingEventEmitter;
  protected readonly prompts: RuntimePromptQueue;

  constructor(protected readonly secrets: SecretSet) {
    super();
    this.events = new RedactingEventEmitter(
      {
        taskEvent: (event) => this.emit('taskEvent', event),
        runtimeOutput: (event) => this.emit('runtimeOutput', event),
        runtimePersistedEnvelope: (envelope) =>
          this.emit('runtimePersistedEnvelope', envelope),
        runtimeTurnCompleted: (event) =>
          this.emit('runtimeTurnCompleted', event),
      },
      secrets,
    );
    this.prompts = new RuntimePromptQueue({
      getSessionId: () => this.currentSessionId(),
      getNextSequence: () => this.events.nextTs(),
      emitRuntimeUpdate: (event) => this.events.outputAndPersist(event),
    });
  }

  protected abstract currentSessionId(): string | undefined;

  get isConnected(): boolean {
    return this.connected && !this.disposed;
  }

  /** `session/prompt` has no mid-turn steering; steers cancel and replay. */
  get supportsNativeTurnSteering(): boolean {
    return false;
  }

  getQueuedMessages(): HarnessQueuedMessage[] {
    return visibleQueuedMessages(this.getQueuedMessageSnapshots());
  }

  getQueuedMessageSnapshots(): QueuedPromptMessageSnapshot[] {
    return this.prompts.snapshot().map((m) => ({
      ...m,
      ...(m.images ? { images: [...m.images] } : {}),
    }));
  }

  /** Masks these values too in everything the agent produces from now on. */
  addSecretValues(values: readonly string[]): void {
    this.secrets.add(values);
  }

  setCommandEnv(env: Record<string, string>): void {
    this.commandEnv = { ...env };
  }

  getCommandEnv(): Record<string, string> {
    return { ...this.commandEnv };
  }
}
