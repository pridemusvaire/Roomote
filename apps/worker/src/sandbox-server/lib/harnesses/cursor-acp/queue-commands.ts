import {
  TaskCommandName,
  extractQueuedMessageId,
  extractQueuedMessageMove,
  type TaskCommand,
} from '../../harness';
import type { RuntimePromptQueue } from '../runtime-prompt-queue';

/** Applies queue-editing commands; returns false for any other command. */
export function applyQueueCommand(
  prompts: RuntimePromptQueue,
  command: TaskCommand,
): boolean {
  switch (command.commandName) {
    case TaskCommandName.RestoreQueuedMessages:
      prompts.restore(command.data.queuedMessages, { emitUpdate: true });
      return true;
    case TaskCommandName.DeleteQueuedMessage: {
      const id = extractQueuedMessageId(command);
      if (id) prompts.deleteById(id);
      return true;
    }
    case TaskCommandName.PrioritizeQueuedMessage: {
      const id = extractQueuedMessageId(command);
      if (id) prompts.prioritize(id);
      return true;
    }
    case TaskCommandName.ReorderQueuedMessage: {
      const move = extractQueuedMessageMove(command);
      if (move) prompts.move(move.id, move.targetId, move.position);
      return true;
    }
    default:
      return false;
  }
}
