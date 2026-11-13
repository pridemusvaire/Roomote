export class CursorModelUnavailableError extends Error {
  constructor(
    readonly requested: string,
    readonly availableIds: string[],
  ) {
    super(
      `Cursor model "${requested}" is not available for this Cursor account. Available models: ${
        availableIds.length > 0 ? availableIds.join(', ') : 'none'
      }.`,
    );
    this.name = 'CursorModelUnavailableError';
  }
}

const NOT_FAST_PARAM = /[[,]fast=false[\],]/;

/**
 * Maps a Roomote model name (`composer-2.5`) onto an id `cursor-agent` lists.
 * `session/set_model` only accepts ids exactly as listed (for example
 * `composer-2.5[fast=true]`), so an exact match wins. Otherwise a listed
 * variant of the model is chosen, preferring one with `fast=false` so the
 * fast tier is not picked while a standard one is on offer. When the fast
 * variant is all Cursor lists for the model (today `composer-2.5` is listed
 * only as `composer-2.5[fast=true]`), it is the model, so it is used: the
 * first listed variant. Never falls back to another model: running Auto
 * silently would bill and behave differently from what the user picked.
 */
export function resolveCursorAgentModelId(
  requested: string,
  available: ReadonlyArray<{ modelId: string }>,
): string {
  const ids = available.map((model) => model.modelId);
  const variants = ids.filter((id) => id.startsWith(`${requested}[`));
  const match =
    ids.find((id) => id === requested) ??
    variants.find((id) => NOT_FAST_PARAM.test(id)) ??
    variants[0];

  if (!match) {
    throw new CursorModelUnavailableError(requested, ids);
  }

  return match;
}
