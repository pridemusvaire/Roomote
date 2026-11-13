/**
 * Sandbox-instruction lines advertising the operator's Argent device host.
 * Workflows such as `review-code` key off the first line's wording ("mobile
 * device host"), so keep it stable.
 */
export function buildDeviceHostInstructionLines(): string[] {
  return [
    '',
    'This deployment connects the sandbox to a remote mobile device host: iOS simulators and Android emulators driven through the installed `argent` CLI (Argent by Software Mansion). `ARGENT_TOOLS_URL` and `ARGENT_AUTH_TOKEN` are already set in your shell, and the CLI reads them automatically. The CLI installs in the background when the task starts. It is ready only when `/tmp/roomote-argent-install-ready` exists; `argent` on PATH alone is not a readiness signal, so wait the way the `verify-on-device` skill describes.',
    'Verify mobile app changes on real devices with the `verify-on-device` skill. Never print, log, or share `ARGENT_AUTH_TOKEN` or the device host URL.',
  ];
}
