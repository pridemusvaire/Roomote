const OPEN_TAG = '<roomote-instructions>';
const CLOSE_TAG = '</roomote-instructions>';

/**
 * Cursor's agent has no system-prompt channel, so Roomote's standing
 * instructions ride in front of the first prompt of a new session as a
 * delimited block. Only the text sent to the agent changes; the transcript
 * keeps the user's own words.
 */
export function withDeveloperInstructions(
  text: string,
  instructions: string | undefined,
): string {
  const content = instructions?.trim();

  if (!content) {
    return text;
  }

  return [
    OPEN_TAG,
    'Standing instructions from the Roomote platform for this whole session. They are not part of the user message below.',
    '',
    content,
    CLOSE_TAG,
    '',
    text,
  ].join('\n');
}
