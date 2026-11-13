const MIN_LENGTH = 8;
/** A value this long is not a word or a default, whatever it is made of. */
const ALWAYS_SECRET_LENGTH = 20;
const CHARACTER_CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

/**
 * Whether a secret variable's value looks like a real secret rather than a
 * development default (`postgres`, `minioadmin`, `changeme`). Such a default
 * is a plain word that turns up in ordinary text (an image name, a hostname),
 * and refusing every call that mentions it leaves the agent unable to work.
 *
 * A value looks real when it is at least 8 characters and either mixes at
 * least two of lowercase, uppercase, digits and symbols, or is 20 or more
 * characters long. Tokens, generated passwords and keys pass; a lone word or
 * number does not.
 *
 * Only the refusal (see `tool-secret-guard`) uses this. Masking a value that
 * leaves the sandbox stays on for every value of 8 or more characters, because
 * hiding a weak secret costs nothing.
 */
export function looksLikeRealSecret(value: string): boolean {
  if (value.length < MIN_LENGTH) {
    return false;
  }

  if (value.length >= ALWAYS_SECRET_LENGTH) {
    return true;
  }

  return CHARACTER_CLASSES.filter((pattern) => pattern.test(value)).length >= 2;
}
