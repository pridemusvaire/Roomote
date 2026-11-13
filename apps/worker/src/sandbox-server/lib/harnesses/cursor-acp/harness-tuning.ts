function parsePositiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value?.trim() ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseList(value: string | undefined): number[] | undefined {
  const parsed = value
    ?.split(',')
    .map(parsePositiveInt)
    .filter((ms): ms is number => ms !== undefined);

  return parsed?.length ? parsed : undefined;
}

/** Timeouts an operator can override through the runtime environment. */
export function readHarnessTuning(runtimeEnv: Record<string, string>) {
  const read = (name: string) => runtimeEnv[name] ?? process.env[name];

  return {
    idleTimeoutMs: parsePositiveInt(read('CURSOR_ACP_IDLE_TIMEOUT_MS')),
    cancelGraceMs: parsePositiveInt(read('CURSOR_ACP_CANCEL_GRACE_MS')),
    requestTimeoutMs: parsePositiveInt(read('CURSOR_ACP_REQUEST_TIMEOUT_MS')),
    loadTimeoutMs: parsePositiveInt(read('CURSOR_ACP_LOAD_TIMEOUT_MS')),
    rateLimitBackoffMs: parseList(read('CURSOR_ACP_RATE_LIMIT_BACKOFF_MS')),
  };
}
