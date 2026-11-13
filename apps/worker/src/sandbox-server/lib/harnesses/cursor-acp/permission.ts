interface PermissionOption {
  optionId: string;
  kind?: string;
}

/**
 * Answer for `session/request_permission`. The sandbox is the trust boundary
 * (same as OpenCode's auto-approve), so grant the broadest allow option.
 */
export function selectPermissionOutcome(params: unknown) {
  const options =
    (params as { options?: PermissionOption[] } | undefined)?.options ?? [];
  const choice =
    options.find((option) => option.kind === 'allow_always') ??
    options.find((option) => option.kind?.startsWith('allow'));

  return choice
    ? { outcome: { outcome: 'selected', optionId: choice.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
