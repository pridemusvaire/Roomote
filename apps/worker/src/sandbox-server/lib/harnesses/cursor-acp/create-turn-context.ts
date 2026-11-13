import type { OpenCodeRuntimeEventEmitter } from '../opencode-server/runtime-event-emitter';
import { DEFAULT_OPENCODE_TURN_STALL_TIMEOUT_MS } from '../opencode-server/stall-watchdogs';
import type { RuntimePromptQueue } from '../runtime-prompt-queue';

import type { CursorAcpHarnessOptions } from './harness-options';
import { CursorSession } from './session';
import type { TurnContext } from './turn-context';
import { createTurnState } from './turn-state';
import { TurnRunner } from './turn-runner';
import type { UpdateTranslator } from './update-translator';
import type { CursorLog } from './acp-types';
import { RATE_LIMIT_BACKOFF_MS } from './prompt-retry';

export const DEFAULT_IDLE_TIMEOUT_MS = DEFAULT_OPENCODE_TURN_STALL_TIMEOUT_MS;
const DEFAULT_CANCEL_GRACE_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_LOAD_TIMEOUT_MS = 120_000;

/** Assembles the collaborators every turn flow works through. */
export function createTurnContext(
  options: CursorAcpHarnessOptions,
  deps: {
    log: CursorLog;
    translator: UpdateTranslator;
    events: OpenCodeRuntimeEventEmitter;
    prompts: RuntimePromptQueue;
    isDisposed: () => boolean;
    requestRestart: TurnContext['requestRestart'];
    requestFallback: TurnContext['requestFallback'];
  },
): TurnContext {
  const { connection } = options;
  const rateLimitBackoffMs =
    options.rateLimitBackoffMs ?? RATE_LIMIT_BACKOFF_MS;
  const session = new CursorSession(connection, {
    workspacePath: options.workspacePath,
    mcpServers: options.mcpServers,
    requestedModel: options.requestedModel,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    loadTimeoutMs: options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
    rateLimitBackoffMs,
    log: deps.log,
  });
  const cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;

  if (options.initialSessionId) {
    session.resume(options.initialSessionId);
  }

  return {
    state: createTurnState(),
    session,
    runner: new TurnRunner(connection, deps.translator, {
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      settleGraceMs: cancelGraceMs,
      rateLimitBackoffMs,
      onStuck: (sessionId) =>
        deps.requestRestart(
          'The Cursor agent did not settle its previous turn',
          sessionId,
        ),
      log: deps.log,
    }),
    events: deps.events,
    prompts: deps.prompts,
    log: deps.log,
    beforeQueuedPrompt: options.beforeQueuedPrompt,
    cancelGraceMs,
    developerInstructions: options.developerInstructionsContent,
    restoreContext: options.restoreContext,
    isDisposed: deps.isDisposed,
    requestRestart: deps.requestRestart,
    requestFallback: deps.requestFallback,
    requestedModel: options.requestedModel,
    fallback: options.fallback,
    closeoutCheck: options.closeoutCheck,
  };
}
