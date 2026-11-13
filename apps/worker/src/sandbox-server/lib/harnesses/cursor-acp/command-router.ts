import { TaskCommandName, type TaskCommand } from '../../harness';

import { applyQueueCommand } from './queue-commands';
import type { PromptData } from './turn-state';
import type { RuntimePromptQueue } from '../runtime-prompt-queue';

export interface CommandHandlers {
  start: (data: PromptData) => Promise<void>;
  send: (
    data: Extract<TaskCommand, { commandName: 'SendMessage' }>['data'],
  ) => Promise<void>;
  cancel: (
    cancelledBy: { name?: string; source?: string } | undefined,
  ) => Promise<void>;
  close: () => Promise<void>;
  resume: (sessionId: string) => void;
}

/** Dispatches every command name; queue edits act on the prompt queue. */
export async function routeCommand(
  prompts: RuntimePromptQueue,
  handlers: CommandHandlers,
  command: TaskCommand,
): Promise<void> {
  if (applyQueueCommand(prompts, command)) {
    return;
  }

  switch (command.commandName) {
    case TaskCommandName.StartNewTask:
      prompts.clear();
      return handlers.start(command.data);
    case TaskCommandName.SendMessage:
      return handlers.send(command.data);
    case TaskCommandName.CancelTask:
      return handlers.cancel(command.data?.cancelledBy);
    case TaskCommandName.CloseTask:
      return handlers.close();
    case TaskCommandName.ResumeTask:
      return handlers.resume(command.data);
  }
}
