import { resolveExpectedOpenCodeCliVersion } from './shared-runtime-packages';

export type Installer = {
  command: string;
  expectedVersion: string;
  label: string;
  installMethod: 'npm';
  packageName?: string;
};

/** CLIs every sandbox needs, installed into the shared sandbox package set. */
export function getInstallers(
  env: NodeJS.ProcessEnv = process.env,
): Installer[] {
  return [
    {
      command: 'opencode',
      expectedVersion: resolveExpectedOpenCodeCliVersion(env),
      label: 'OpenCode CLI',
      installMethod: 'npm',
      packageName: 'opencode-ai',
    },
  ];
}
