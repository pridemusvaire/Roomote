const REDACTED = '[redacted]';
/** Shorter values are too likely to match ordinary text to mask. */
const MIN_SECRET_LENGTH = 8;

/** The secret values worth masking. */
export function maskableSecrets(values: readonly string[]): string[] {
  return values.filter((value) => value.length >= MIN_SECRET_LENGTH);
}

/**
 * The values to mask, shared by everything that masks for one task (the event
 * emitter, its stream maskers, the agent's stderr log) so a secret that reaches
 * the task later is masked by all of them at once. Values are only added.
 */
export class SecretSet {
  private current: string[];

  constructor(values: readonly string[] = []) {
    this.current = maskableSecrets([...new Set(values)]);
  }

  get values(): readonly string[] {
    return this.current;
  }

  add(values: readonly string[]): void {
    this.current = maskableSecrets([...new Set([...this.current, ...values])]);
  }
}

/**
 * Replaces every exact occurrence of a secret value in `text`. Longest first:
 * masking a short secret that is the start of a longer one would leave the
 * longer one's tail in the clear.
 */
export function maskText(text: string, secrets: readonly string[]): string {
  const longestFirst = [...secrets].sort((a, b) => b.length - a.length);

  return longestFirst.reduce(
    (masked, secret) => masked.split(secret).join(REDACTED),
    text,
  );
}

/** Masks every string inside a plain JSON-like value; other values pass. */
export function maskDeep<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === 'string') {
    return maskText(value, secrets) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskDeep(item, secrets)) as T;
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        maskDeep(item, secrets),
      ]),
    ) as T;
  }

  return value;
}
