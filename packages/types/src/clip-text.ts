/**
 * Caps `text` at `max` characters, marking the cut with an ellipsis. Keeps the
 * start, or with `keep: 'end'` the end, for text whose latest part matters
 * most (the end of a long agent reply is where it ended up).
 */
export function clipText(
  text: string,
  max: number,
  keep: 'start' | 'end' = 'start',
): string {
  if (text.length <= max) {
    return text;
  }

  return keep === 'start'
    ? `${text.slice(0, max - 1).trimEnd()}…`
    : `…${text.slice(text.length - (max - 1)).trimStart()}`;
}
