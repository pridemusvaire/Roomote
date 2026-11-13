import { getEventListeners } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa, type ResultPromise } from 'execa';

import { killAgentTree } from '../cursor-acp/agent-process-tree';
import { closeOnAgentExit } from '../cursor-acp/close-on-agent-exit';
import { trackAgentProcess } from '../cursor-acp/track-agent-process';
import { isAlive, waitFor } from './cursor-acp-test-harness';

const HOST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'agent-tree-host.ts',
);

const groupAlive = (pgid: number) => isAlive(-pgid);
const spawnAgent = (script: string): ResultPromise => {
  const agent = execa('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
  });
  agent.catch(() => {});
  return agent;
};

describe.each([
  ['', {}],
  [', with signal-exit already hooked', { SIGNAL_EXIT_FIRST: '1' }],
])('when the worker is signalled%s', (_label, hostEnv) => {
  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)(
    'ends the agent on %s and still lets the worker die by it',
    async (signal) => {
      const host = execa(process.execPath, ['--import', 'tsx', HOST], {
        buffer: false,
        reject: false,
        env: hostEnv,
      });
      const lines: string[] = [];
      host.stdout!.on('data', (chunk: Buffer) => lines.push(String(chunk)));
      await waitFor(() => lines.join('').includes('agent-pid:'), 15_000);
      const agentPid = Number(/agent-pid:(\d+)/.exec(lines.join(''))![1]);

      expect(isAlive(agentPid)).toBe(true);
      host.kill(signal);
      const result = await host;

      expect(result.signal).toBe(signal);
      await waitFor(() => !groupAlive(agentPid));
    },
    30_000,
  );
});

describe('killAgentTree', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never signals a process group once its agent exited and the group is empty', async () => {
    const agent = spawnAgent('exit 0');
    await agent;
    const kill = vi.spyOn(process, 'kill');

    killAgentTree(agent);
    killAgentTree(agent, 'SIGKILL');

    const signals = kill.mock.calls.filter(([, signal]) => signal !== 0);
    expect(signals).toEqual([]);
  });

  it('stops the group member that ignores SIGTERM, after the agent itself exited', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    try {
      const agent = spawnAgent('(trap "" TERM; exec sleep 300) & wait');
      const pgid = agent.pid!;
      await new Promise((resolve) => setTimeout(resolve, 200));

      killAgentTree(agent);
      await agent.catch(() => {});
      await waitFor(() => !isAlive(pgid));

      expect(groupAlive(pgid)).toBe(true);
      vi.advanceTimersByTime(5_000);
      await waitFor(() => !groupAlive(pgid));
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops probing once the group is gone, so a reused id is never signalled', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    try {
      const agent = spawnAgent('exec sleep 300');
      await new Promise((resolve) => setTimeout(resolve, 100));
      killAgentTree(agent);
      await agent.catch(() => {});
      await waitFor(() => !groupAlive(agent.pid!));
      const kill = vi.spyOn(process, 'kill');

      vi.advanceTimersByTime(10_000);

      expect(kill.mock.calls.filter(([, s]) => s === 'SIGKILL')).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('trackAgentProcess', () => {
  it('drops its cancel listener when the agent exits, however many are spawned', async () => {
    const signal = new AbortController().signal;

    for (let i = 0; i < 5; i += 1) {
      const agent = spawnAgent('exit 0');
      trackAgentProcess(agent, signal);
      await agent;
    }

    await waitFor(() => getEventListeners(signal, 'abort').length === 0);
  });

  it('keeps the cancel listener while a member of the group survives the agent', async () => {
    const abort = new AbortController();
    const agent = spawnAgent('(exec sleep 300) & exit 0');
    trackAgentProcess(agent, abort.signal);
    await agent;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(1);
    abort.abort();
    await waitFor(() => !groupAlive(agent.pid!));
  });

  it('registers process exit and signal hooks once, however many agents are tracked', async () => {
    const listeners = () =>
      ['exit', 'SIGTERM', 'SIGINT', 'SIGHUP'].map((event) =>
        process.listenerCount(event),
      );
    const first = spawnAgent('exit 0');
    trackAgentProcess(first, new AbortController().signal);
    const afterFirst = listeners();

    for (let i = 0; i < 4; i += 1) {
      const agent = spawnAgent('exit 0');
      trackAgentProcess(agent, new AbortController().signal);
      await agent;
    }

    expect(listeners()).toEqual(afterFirst);
  });
});

describe('closeOnAgentExit', () => {
  it('closes the connection after the agent exits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    try {
      const agent = spawnAgent('exit 0');
      const close = vi.fn();
      closeOnAgentExit(agent, { close } as never);
      await agent;
      vi.advanceTimersByTime(300);

      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
