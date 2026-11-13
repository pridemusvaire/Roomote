import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AcpMessage,
  AcpPersistedEnvelope,
  AcpTurnCompletedEvent,
  TaskEvent,
} from '@roomote/types';

import type { Harness } from '../../harness';
import { startCursorAcpHarness } from '../cursor-acp/start';

const FAKE_AGENT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-cursor-acp.mjs',
);

const logger = {
  runId: 1,
  filePath: '/dev/null',
  log: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** One JSON-RPC message the fake agent received, as logged by the fixture. */
interface AgentMessage {
  method?: string;
  params: {
    sessionId?: string;
    modelId?: string;
    cwd?: string;
    mcpServers?: unknown;
    prompt: Array<{ text: string }>;
  };
  permissionReply?: unknown;
  childPid?: number;
  spawnEnv?: Record<string, string | undefined>;
}

type StartOptions = Parameters<typeof startCursorAcpHarness>[0];

/** Starts the Cursor harness against the fake ACP agent and records output. */
export async function startFakeCursorHarness(options?: {
  env?: Record<string, string>;
  start?: Partial<StartOptions>;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-acp-'));
  const logFile = path.join(dir, 'agent.jsonl');
  const abort = new AbortController();
  const { harness, subprocess } = await startCursorAcpHarness({
    workspacePath: dir,
    runtimeEnv: {
      PATH: process.env.PATH ?? '',
      CURSOR_API_KEY: 'test-key',
      FAKE_ACP_LOG: logFile,
      ...options?.env,
    },
    cancelSignal: abort.signal,
    logger,
    mcpServers: {},
    agentCommand: { command: process.execPath, args: [FAKE_AGENT] },
    ...options?.start,
  });

  /** Ordered labels of everything the harness emitted. */
  const timeline: string[] = [];
  const taskEvents: TaskEvent[] = [];
  const persisted: AcpPersistedEnvelope[] = [];
  const live: AcpMessage[] = [];
  const turnCompleted: AcpTurnCompletedEvent[] = [];

  harness.on('taskEvent', (event) => {
    taskEvents.push(event);
    timeline.push(`task:${event.eventName}`);
  });
  harness.on('runtimePersistedEnvelope', (envelope) => {
    persisted.push(envelope);
    timeline.push(`persisted:${envelope.eventType}`);
  });
  harness.on('runtimeOutput', (event) => {
    live.push(event);
    timeline.push(`live:${event.eventType}`);
  });
  harness.on('runtimeTurnCompleted', (event) => {
    turnCompleted.push(event);
    timeline.push('turn_completed');
  });

  const agentLog = () =>
    fs.existsSync(logFile)
      ? fs
          .readFileSync(logFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentMessage)
      : [];

  const dispose = () => {
    harness.dispose();
    abort.abort();
  };

  return {
    harness: harness as Harness,
    subprocess,
    timeline,
    taskEvents,
    persisted,
    live,
    turnCompleted,
    agentLog,
    dispose,
  };
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const startTask = (text: string) =>
  ({ commandName: 'StartNewTask', data: { text } }) as const;
