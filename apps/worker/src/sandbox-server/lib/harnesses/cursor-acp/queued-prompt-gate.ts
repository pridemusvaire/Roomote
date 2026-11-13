import type { QueuedPromptMessageSnapshot } from '../../harness';

export type BeforeQueuedPrompt = (input: {
  userId?: string;
  clientMessageId?: string;
  kind: 'queuedPrompt' | 'userInputAnswer';
}) => Promise<void | {
  shouldReconnect: boolean;
  shouldBlockPrompt?: boolean;
  shouldSkipPrompt?: boolean;
  reason?: string;
}>;

export type QueuedPromptVerdict =
  | 'deliver'
  | 'skip'
  | 'block'
  | { reconnect: string };

/**
 * Asks the worker whether a queued prompt may run now (actor-scope and MCP
 * readiness checks) and translates the answer into one verdict.
 */
export async function checkQueuedPrompt(
  beforeQueuedPrompt: BeforeQueuedPrompt | undefined,
  prompt: QueuedPromptMessageSnapshot,
): Promise<QueuedPromptVerdict> {
  const result = await beforeQueuedPrompt?.({
    userId: prompt.userId,
    clientMessageId: prompt.clientMessageId,
    kind: 'queuedPrompt',
  });

  if (!result) {
    return 'deliver';
  }

  if (result.shouldSkipPrompt) {
    return 'skip';
  }

  if (result.shouldBlockPrompt) {
    return 'block';
  }

  return result.shouldReconnect
    ? { reconnect: result.reason ?? 'Queued prompt requested MCP reconnect' }
    : 'deliver';
}
