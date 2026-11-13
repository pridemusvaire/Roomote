import type { MaskSecret } from '../../lib/mask-secrets-file.js';

/** Every string anywhere in a JSON-like value. */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* strings(item);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) yield* strings(item);
  }
}

/** The variables whose values appear in `input`, once each. */
export function namesInInput(input: unknown, secrets: readonly MaskSecret[]) {
  const texts = [...strings(input)];

  return [
    ...new Set(
      secrets
        .filter(({ value }) => texts.some((text) => text.includes(value)))
        .map(({ name }) => name),
    ),
  ];
}
