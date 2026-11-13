/**
 * A stand-in for the worker: spawns a detached "agent" the way
 * `spawnCursorAgent` does, tracks it, reports its pid, then waits to be
 * signalled by the test. Run through tsx so the real modules are exercised.
 *
 * With `SIGNAL_EXIT_FIRST` set it also hooks `signal-exit` before the agent is
 * tracked, as execa does when it spawns: that library then decides whether to
 * re-raise a signal by counting the listeners it finds, which a hand-rolled
 * handler registered after it must not confuse.
 */
import { execa } from 'execa';
import { onExit } from 'signal-exit';

import { trackAgentProcess } from '../../cursor-acp/track-agent-process';

if (process.env.SIGNAL_EXIT_FIRST) {
  onExit(() => {});
}

const agent = execa('sleep', ['300'], { detached: true, buffer: false });
agent.catch(() => {});
trackAgentProcess(agent, new AbortController().signal);

console.log(`agent-pid:${agent.pid}`);
setInterval(() => {}, 1000);
