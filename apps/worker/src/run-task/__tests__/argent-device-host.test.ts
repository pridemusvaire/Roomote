const { installArgentCliMock, rmSyncMock, writeFileSyncMock } = vi.hoisted(
  () => ({
    installArgentCliMock: vi.fn(),
    rmSyncMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
  }),
);

vi.mock('node:fs', () => ({
  rmSync: rmSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('../../commands/setup/argent-cli', async (original) => ({
  ...(await original<typeof import('../../commands/setup/argent-cli')>()),
  installArgentCli: installArgentCliMock,
}));

import {
  ARGENT_INSTALL_FAILED_MARKER,
  ARGENT_INSTALL_READY_MARKER,
  startArgentDeviceHost,
} from '../argent-device-host';

const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const configuredEnv = { ARGENT_TOOLS_URL: 'https://devices.example.test' };

describe('startArgentDeviceHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays disabled and installs nothing without a configured host', async () => {
    for (const env of [{}, { ARGENT_TOOLS_URL: 'not a url' }]) {
      const host = startArgentDeviceHost(env, logger);

      expect(host.enabled).toBe(false);
      await expect(host.installed).resolves.toBe(false);
    }

    expect(installArgentCliMock).not.toHaveBeenCalled();
  });

  it('enables immediately without waiting for the install to finish', async () => {
    let finishInstall: () => void = () => {};
    installArgentCliMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishInstall = resolve;
      }),
    );

    const host = startArgentDeviceHost(configuredEnv, logger);

    expect(host.enabled).toBe(true);
    expect(installArgentCliMock).toHaveBeenCalledWith(logger, configuredEnv);
    // Markers from a resumed sandbox are cleared before the install starts,
    // and nothing signals ready while it is still running.
    for (const marker of [
      ARGENT_INSTALL_READY_MARKER,
      ARGENT_INSTALL_FAILED_MARKER,
    ]) {
      expect(rmSyncMock).toHaveBeenCalledWith(marker, { force: true });
    }
    expect(writeFileSyncMock).not.toHaveBeenCalled();

    finishInstall();
    await expect(host.installed).resolves.toBe(true);
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      ARGENT_INSTALL_READY_MARKER,
      expect.any(String),
    );
    expect(writeFileSyncMock).not.toHaveBeenCalledWith(
      ARGENT_INSTALL_FAILED_MARKER,
      expect.anything(),
    );
  });

  it('logs a failed install without rejecting, so the task never fails on it', async () => {
    installArgentCliMock.mockRejectedValueOnce(new Error('npm exploded'));

    const host = startArgentDeviceHost(configuredEnv, logger);

    await expect(host.installed).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('device verification is unavailable'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('npm exploded'),
    );
    // The skill stops waiting as soon as this marker exists.
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      ARGENT_INSTALL_FAILED_MARKER,
      expect.any(String),
    );
    expect(writeFileSyncMock).not.toHaveBeenCalledWith(
      ARGENT_INSTALL_READY_MARKER,
      expect.anything(),
    );
  });

  it('never rejects even when the failure marker cannot be written', async () => {
    installArgentCliMock.mockRejectedValueOnce(new Error('npm exploded'));
    writeFileSyncMock.mockImplementationOnce(() => {
      throw new Error('EROFS');
    });

    await expect(
      startArgentDeviceHost(configuredEnv, logger).installed,
    ).resolves.toBe(false);
  });

  it('names the same markers the verify-on-device skill waits on', async () => {
    // node:fs is mocked above for the marker writes; read the skill for real.
    const { readFileSync } =
      await vi.importActual<typeof import('node:fs')>('node:fs');
    const skill = readFileSync(
      new URL(
        '../../../../../packages/cloud-agents/src/server/workflows/skills/standard/verify-on-device/SKILL.md',
        import.meta.url,
      ),
      'utf8',
    );

    expect(skill).toContain(ARGENT_INSTALL_READY_MARKER);
    expect(skill).toContain(ARGENT_INSTALL_FAILED_MARKER);
  });
});
