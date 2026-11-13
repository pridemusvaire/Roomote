import type {
  HarnessQueuedMessage,
  QueuedPromptMessageSnapshot,
} from '../../harness';

/** The follow-ups a user can see (and edit) in the transcript queue. */
export function visibleQueuedMessages(
  queue: QueuedPromptMessageSnapshot[],
): HarnessQueuedMessage[] {
  return queue
    .filter((m) => !m.queueOnly && m.visibleInTranscript !== false)
    .map((m) => ({
      id: m.id,
      text: m.text,
      timestamp: m.timestamp,
      ...(m.images ? { images: [...m.images] } : {}),
      ...(m.userName ? { userName: m.userName } : {}),
      ...(m.userImageUrl ? { userImageUrl: m.userImageUrl } : {}),
      ...(m.clientMessageId ? { clientMessageId: m.clientMessageId } : {}),
    }));
}
