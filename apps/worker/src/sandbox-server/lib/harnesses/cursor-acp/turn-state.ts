import type { QueuedPromptMessageSnapshot } from '../../harness';

export interface PromptData {
  text: string;
  images?: string[];
  workflowPhase?: string;
  visibleInTranscript?: boolean;
  source?: string;
  userId?: string;
  userName?: string;
  userImageUrl?: string;
  clientMessageId?: string;
}

/** Mutable turn bookkeeping shared by the turn, queue and cancel flows. */
export interface TurnState {
  inFlight: boolean;
  /** Set while a cancel is stopping the turn; the cancel owns the ending. */
  cancelling: boolean;
  /**
   * Set once a plan-limit failure has asked for the model to be switched,
   * until the worker replaces this harness or a user stop ends the switch.
   * No turn is running, but the agent must not be given anything: a message
   * sent now is queued, and the replacement harness inherits the queue.
   */
  switching: boolean;
  /** Bumped by cancel/close so a turn still starting up can tell it lost. */
  generation: number;
  turnPromise: Promise<void>;
  /** The session start of the prompt being submitted, while it is running. */
  starting: Promise<string | undefined> | undefined;
  workflowPhase: string | null;
  retryTimer: NodeJS.Timeout | undefined;
  /**
   * The queued prompt a drain took off the queue and is still awaiting the
   * worker's verdict on. Whoever clears it (a steer puts the prompt back, a
   * stop or close drops it) has taken it over; the drain then lets go of it.
   */
  claimedPrompt: QueuedPromptMessageSnapshot | undefined;
  /** The session being announced to the manager, if any. */
  announcedSessionId: string | undefined;
  /** Context for the next new session's first prompt, from a lost session. */
  restoredContext: string | undefined;
  /** Closeout reminders sent for the turn being worked on. */
  closeoutReminders: number;
  /** Last message of a turn the closeout check blocked. */
  blockedCloseoutText: string | null;
}

export function createTurnState(): TurnState {
  return {
    inFlight: false,
    cancelling: false,
    switching: false,
    generation: 0,
    turnPromise: Promise.resolve(),
    starting: undefined,
    workflowPhase: null,
    retryTimer: undefined,
    claimedPrompt: undefined,
    announcedSessionId: undefined,
    restoredContext: undefined,
    closeoutReminders: 0,
    blockedCloseoutText: null,
  };
}
