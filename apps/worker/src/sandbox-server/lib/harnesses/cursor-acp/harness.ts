import { TaskCommandName, type Harness, type TaskCommand } from '../../harness';
import { createPrefixedLogger, describeUnknownError } from '../logging';

import { initializeAgent } from './agent-initialize';
import { routeCommand, type CommandHandlers } from './command-router';
import { CursorHarnessBase } from './harness-base';
import { createTurnContext } from './create-turn-context';
import type { CursorAcpHarnessOptions } from './harness-options';
import { settleTurnBeforeDisconnect, stopTurnsForDispose } from './turn-closed';
import type { TurnContext } from './turn-context';
import { createCommandHandlers } from './turn-handlers';
import { UpdateTranslator } from './update-translator';
import { wireConnection } from './wire-connection';

export class CursorAcpHarness extends CursorHarnessBase implements Harness {
  private readonly ctx: TurnContext;
  private readonly handlers: CommandHandlers;

  constructor(private readonly options: CursorAcpHarnessOptions) {
    super(options.secrets);
    const { connection } = options;
    const log = createPrefixedLogger(options.logger, '[cursor-acp]');
    const translator = new UpdateTranslator(this.events, options.mcpServers);
    this.ctx = createTurnContext(options, {
      log,
      translator,
      events: this.events,
      prompts: this.prompts,
      isDisposed: () => this.disposed,
      requestRestart: (reason, sessionId) =>
        this.emit('restartRequested', { reason, sessionId }),
      requestFallback: (request) =>
        this.emit('modelFallbackRequested', request),
    });
    this.handlers = createCommandHandlers(this.ctx);

    wireConnection(connection, translator, () => void this.onAgentClosed());
  }

  protected currentSessionId(): string | undefined {
    return this.ctx.session.id;
  }

  getCurrentWorkflowPhase(): string | null {
    return this.ctx.state.workflowPhase;
  }

  async connect(): Promise<void> {
    await initializeAgent(this.options.connection);
    this.connected = true;
    this.emit('connected');
  }

  sendCommand(command: TaskCommand): boolean {
    if (this.disposed || !this.connected) {
      return false;
    }

    if (command.commandName === TaskCommandName.AnswerUserInputRequest) {
      this.ctx.log.warn('Ignoring AnswerUserInputRequest: never asked for.');
      return false;
    }

    void routeCommand(this.prompts, this.handlers, command).catch(
      (error: unknown) => {
        this.ctx.log.error(
          `Command ${command.commandName} failed: ${describeUnknownError(error)}`,
        );
        this.emit('commandError', { command, error });
      },
    );
    return true;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.connected = false;
    stopTurnsForDispose(this.ctx);
    this.options.connection.close();
    this.options.onDispose?.();
    this.emit('disconnected');
  }

  private async onAgentClosed(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.connected = false;
    this.ctx.log.warn('Cursor agent connection closed');

    await settleTurnBeforeDisconnect(this.ctx);
    this.emit('disconnected');
  }
}
