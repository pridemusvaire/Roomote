import {
  FALLBACK_STOP_HOOK_REMINDER,
  MAX_STOP_HOOK_REMINDERS,
} from '../slack-stop-hook';

import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';

/** Source of the hidden follow-up that asks for the missing closeout. */
export const CLOSEOUT_REMINDER_SOURCE = 'cursor-stop-hook';

type CloseoutVerdict =
  | { kind: 'remind'; prompt: PromptData }
  | {
      kind: 'complete';
      text: string;
      /** Set when the closeout is still missing after every reminder. */
      missingCloseout?: { reminderCount: number };
    };

/**
 * Decides what an ended turn does next. A blocked turn is reminded with the
 * hook's own text as a hidden prompt, up to the same bound OpenCode uses;
 * after that it completes without a closeout and the platform delivers one.
 */
export function judgeCloseout(ctx: TurnContext, text: string): CloseoutVerdict {
  const { state, closeoutCheck } = ctx;
  const decision = closeoutCheck?.();

  if (!decision?.blocked) {
    state.closeoutReminders = 0;
    state.blockedCloseoutText = null;
    return { kind: 'complete', text };
  }

  if (text.trim()) {
    state.blockedCloseoutText = text;
  }

  if (state.closeoutReminders >= MAX_STOP_HOOK_REMINDERS) {
    ctx.log.warn(
      `Chat closeout still missing after ${MAX_STOP_HOOK_REMINDERS} reminders; completing the turn without one`,
    );
    const reminderCount = state.closeoutReminders;
    const lastText = state.blockedCloseoutText;
    state.closeoutReminders = 0;
    state.blockedCloseoutText = null;

    return {
      kind: 'complete',
      text: text.trim() ? text : (lastText ?? ''),
      missingCloseout: { reminderCount },
    };
  }

  state.closeoutReminders += 1;
  ctx.log.info(`Chat closeout reminder ${state.closeoutReminders} submitted`);

  return {
    kind: 'remind',
    prompt: {
      text: decision.reason ?? FALLBACK_STOP_HOOK_REMINDER,
      visibleInTranscript: false,
      source: CLOSEOUT_REMINDER_SOURCE,
    },
  };
}
