#!/usr/bin/env node
/* global process, setTimeout */
// Fake `cursor-agent acp` for harness tests. Speaks the ACP behaviour probed
// from the real agent (newline-delimited JSON-RPC over stdio).
//
// Env:
//   FAKE_ACP_LOG            append every inbound message as JSONL to this file
//   FAKE_ACP_MODELS         comma list of available model ids
//   FAKE_ACP_OMIT_MODEL     drop listed models that start with this prefix
//   FAKE_ACP_PROMPT_DELAY_MS  time a normal turn takes (default 20)
//   FAKE_ACP_FAIL_NEW       make session/new fail ('1', or the original error message, JSON or text)
//   FAKE_ACP_QUOTA_ERROR    the original error message of the `quota` mode (default: a plan-limit code)
//   FAKE_ACP_FAIL_LOAD      make session/load fail (the session no longer exists)
//   FAKE_ACP_NEW_DELAY_MS   delay before answering session/new
//   FAKE_ACP_LOAD_DELAY_MS  delay before answering session/load
//   FAKE_ACP_SATISFY_FILE   a prompt asking for a closeout writes a satisfied reply state here
//   FAKE_ACP_FAIL_SET_MODEL make session/set_model fail with this message
//   FAKE_ACP_STALL_NEW      never answer session/new
//   FAKE_ACP_STALL_LOAD     never answer session/load
//   FAKE_ACP_STALL_SET_MODEL  never answer session/set_model
//   FAKE_ACP_TOOL_MS        how long the `slowtool` mode's command runs silently (default 500)
//   FAKE_ACP_RATE_LIMIT_NEW   how many session/new requests are throttled (RATE_LIMITED) before one succeeds
//   FAKE_ACP_RATE_LIMIT_LOAD  how many session/load requests are throttled the same way
//   FAKE_ACP_RATE_LIMITS    how many prompts the `ratelimit` mode throttles (default 2)
//   FAKE_ACP_CANCEL_DELAY_MS  how long `hold` takes to answer after a cancel
//   FAKE_ACP_CHUNK_SIZE     stream the reply in chunks of this many characters (splits secrets mid-value)
//   FAKE_ACP_SPAWN_CHILD    start a long-lived child process (an MCP server stand-in) and log its pid
//   FAKE_ACP_STDERR_ENV     write a line to stderr that carries the value of this environment variable
//   FAKE_ACP_MODE           default prompt mode (echo|tool|envtool|plan|ratelimittool|exitkeep|mcp|mcpenv|permission|stall|exit|hold|quota|quotatext|quotarefuse|ratelimit|slowtool|stderr)
// A prompt whose text contains `[mode]` overrides the mode for that prompt.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

const log = (message) => {
  if (process.env.FAKE_ACP_LOG) {
    fs.appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify(message)}\n`);
  }
};
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = (sessionId, body) =>
  send({
    method: 'session/update',
    params: { sessionId, update: body },
  });
// VERIFIED against the cursor-agent 2026.11.11 bundle: ACP returns a failed
// backend request as JSON-RPC -32603 "Internal error", with `data` set to
// JSON.parse(original error message) when that is JSON, else
// `{ details: <message> }`. Cursor's own error codes ride inside that data.
const internalError = (original) => {
  let data;
  try {
    data = JSON.parse(original);
  } catch {
    data = { details: original };
  }
  return { code: -32603, message: 'Internal error', data };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

log({
  spawnEnv: {
    HOME: process.env.HOME,
    CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    LEAKED: process.env.CURSOR_TEST_PARENT_ONLY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CUSTOM_PROVIDER_KEY: process.env.CUSTOM_PROVIDER_KEY,
    GITLAB_TOKEN: process.env.GITLAB_TOKEN,
  },
});
if (process.env.FAKE_ACP_STDERR_ENV) {
  process.stderr.write(
    `warning: bad credential ${process.env[process.env.FAKE_ACP_STDERR_ENV]}\n`,
  );
}
// A long-lived child, as a stdio MCP server the agent started would be.
const longLived = (stdio) =>
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio });
if (process.env.FAKE_ACP_SPAWN_CHILD) {
  log({ childPid: longLived('ignore').pid });
}
const delayMs = Number(process.env.FAKE_ACP_PROMPT_DELAY_MS ?? 20);
let models = (
  process.env.FAKE_ACP_MODELS ??
  'default[],composer-2.5[fast=true],composer-2.5[fast=false]'
).split(',');
if (process.env.FAKE_ACP_OMIT_MODEL) {
  models = models.filter(
    (id) => !id.startsWith(process.env.FAKE_ACP_OMIT_MODEL),
  );
}
const modelsPayload = () => ({
  currentModelId: models[0],
  availableModels: models.map((modelId) => ({ modelId, name: modelId })),
});

let sessionCounter = 0;
let nextServerRequestId = 1000;
const cancelled = new Set();
let rateLimitsLeft = Number(process.env.FAKE_ACP_RATE_LIMITS ?? 2);
const serverReplies = new Map();
const setupThrottlesLeft = {
  new: Number(process.env.FAKE_ACP_RATE_LIMIT_NEW ?? 0),
  load: Number(process.env.FAKE_ACP_RATE_LIMIT_LOAD ?? 0),
};
const throttleSetup = (id, method) =>
  setupThrottlesLeft[method]-- > 0
    ? (send({
        id,
        error: internalError(
          JSON.stringify({ code: 'RATE_LIMITED', message: 'Rate limited' }),
        ),
      }),
      true)
    : false;

async function runPrompt(id, params) {
  const { sessionId } = params;
  const text = params.prompt.map((block) => block.text ?? '').join('\n');
  const marker = /\[(\w+)\]/.exec(text)?.[1];
  const mode = marker ?? process.env.FAKE_ACP_MODE ?? 'echo';
  cancelled.delete(sessionId);

  // The agent posted its closeout in response to a stop-hook reminder.
  if (process.env.FAKE_ACP_SATISFY_FILE && text.includes('Before finalizing')) {
    fs.writeFileSync(
      process.env.FAKE_ACP_SATISFY_FILE,
      JSON.stringify({
        currentTurnMessageTs: '111.222',
        messageTs: '111.223',
        tool: 'send_chat_reply',
        replyPurpose: 'closeout',
        recordedAtMs: Date.now(),
        satisfiedTurnMessageTs: '111.222',
        terminalSatisfiedTurnMessageTs: '111.222',
        terminalSatisfiedAtMs: Date.now(),
      }),
    );
  }

  // A stalled agent produces no output at all (observed on the real agent).
  if (mode === 'stall') return;

  // Plan exhausted: Cursor fails the request instead of billing.
  if (mode === 'quota') {
    send({
      id,
      error: internalError(
        process.env.FAKE_ACP_QUOTA_ERROR ??
          JSON.stringify({
            code: 'PRO_USER_USAGE_LIMIT',
            message:
              'You have reached your usage limit. Upgrade your plan to continue.',
          }),
      ),
    });
    return;
  }

  // A transient throttle: the same prompt succeeds once it has cleared.
  // `ratelimittool` runs a command before the throttle: work already done.
  if (
    (mode === 'ratelimit' || mode === 'ratelimittool') &&
    rateLimitsLeft-- > 0
  ) {
    if (mode === 'ratelimittool') {
      update(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: `tc-rl-${rateLimitsLeft}`,
        title: 'Run deploy',
        kind: 'execute',
        status: 'completed',
        rawInput: { command: 'deploy' },
      });
    }
    send({
      id,
      error: internalError(
        JSON.stringify({
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded, try again later.',
        }),
      ),
    });
    return;
  }

  if (mode === 'quotatext' || mode === 'quotarefuse') {
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: "You've hit your usage limit for this plan.",
      },
    });
    send({
      id,
      result: { stopReason: mode === 'quotarefuse' ? 'refusal' : 'end_turn' },
    });
    return;
  }

  // A leftover of a session this turn abandoned.
  if (mode === 'stale') {
    update('other-session', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'STALE LEFTOVER' },
    });
  }

  update(sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'thinking' },
  });

  if (mode === 'tool') {
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Run ls',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'ls' },
    });
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      rawOutput: { exitCode: 0, stdout: 'a.txt\n', stderr: '' },
    });
  }

  // `env` run by the agent: prints every variable it was given, and a line that
  // shows a token with no variable name next to it for a pattern to catch.
  if (mode === 'envtool') {
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-env',
      title: 'Run env',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'env' },
    });
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-env',
      status: 'completed',
      rawOutput: {
        exitCode: 0,
        stdout: `${Object.entries(process.env)
          .map(([name, value]) => `${name}=${value}`)
          .join('\n')}\nremote answered for ${process.env.GITLAB_TOKEN}\n`,
        stderr: '',
      },
    });
  }

  // VERIFIED against cursor-agent 2026.11.11 on 2026-11-12 with a stdio MCP
  // server named "roomote": the call starts as an anonymous `MCP: tool` stub
  // with empty rawInput, and the next update names the server and tool in
  // rawInput.providerIdentifier / toolName with the arguments under `args`.
  // No permission request is made. `tool_call_update` then reports in_progress
  // and completed with rawOutput `{ success: true }`.
  const mcpCall = (toolCallId, toolName, args, rawOutput) => {
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'MCP: tool',
      kind: 'other',
      status: 'pending',
      rawInput: {},
    });
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: `roomote: ${toolName}`,
      rawInput: { providerIdentifier: 'roomote', toolName, args },
    });
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'in_progress',
    });
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'completed',
      rawOutput,
    });
  };

  // A command that runs silently for a long time before it finishes.
  if (mode === 'slowtool') {
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-slow',
      title: 'Run build',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'build' },
    });
    await sleep(Number(process.env.FAKE_ACP_TOOL_MS ?? 500));
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-slow',
      status: 'completed',
      rawOutput: { exitCode: 0, stdout: 'slow output\n', stderr: '' },
    });
  }

  if (mode === 'mcp') {
    mcpCall(
      'tool_mcp',
      'reply_to_slack_thread',
      { text: 'hello from composer' },
      {
        success: true,
      },
    );
  }

  if (mode === 'mcpenv') {
    mcpCall(
      'tool_env',
      'request_environment_variables',
      { names: ['STRIPE_KEY'] },
      { success: true, requestedNames: ['STRIPE_KEY'] },
    );
  }

  if (mode === 'permission') {
    const requestId = nextServerRequestId++;
    const reply = new Promise((resolve) =>
      serverReplies.set(requestId, resolve),
    );
    send({
      id: requestId,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 'tc-2' },
        options: [
          { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Always', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
    log({ permissionReply: await reply });
  }

  // A warning on stderr that echoes the prompt, as an agent echoes a credential.
  if (mode === 'stderr') {
    process.stderr.write(`warning: ${text.replace(/\[\w+\]/, '').trim()}\n`);
  }

  // An execution plan whose entry echoes the prompt.
  if (mode === 'plan') {
    update(sessionId, {
      sessionUpdate: 'plan',
      entries: [
        {
          content: `plan: ${text.replace(/\[\w+\]/, '').trim()}`,
          status: 'pending',
          priority: 'medium',
        },
      ],
    });
  }

  const reply = `reply: ${text.replace(/\[\w+\]/, '').trim()}`;
  const chunkSize =
    Number(process.env.FAKE_ACP_CHUNK_SIZE ?? 0) || reply.length;
  for (let at = 0; at < reply.length; at += chunkSize) {
    update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: reply.slice(at, at + chunkSize) },
    });
  }

  if (mode === 'exit') process.exit(3);

  // The agent dies but leaves a child holding its stdout open, so the pipe
  // never reaches EOF.
  if (mode === 'exitkeep') {
    log({ childPid: longLived(['ignore', 'inherit', 'inherit']).pid });
    process.exit(0);
  }

  const deadline = Date.now() + (mode === 'hold' ? 60_000 : delayMs);
  while (Date.now() < deadline && !cancelled.has(sessionId)) await sleep(5);
  if (cancelled.has(sessionId)) {
    await sleep(Number(process.env.FAKE_ACP_CANCEL_DELAY_MS ?? 0));
  }
  log({ promptSettled: sessionId });

  send({
    id,
    result: {
      stopReason: cancelled.has(sessionId) ? 'cancelled' : 'end_turn',
    },
  });
}

const newSession = (id) =>
  process.env.FAKE_ACP_FAIL_NEW
    ? send({
        id,
        error:
          process.env.FAKE_ACP_FAIL_NEW === '1'
            ? // Observed on the real agent without a login.
              {
                code: -32000,
                message: 'Authentication required',
                data: { message: 'Authentication required.' },
              }
            : internalError(process.env.FAKE_ACP_FAIL_NEW),
      })
    : send({
        id,
        result: {
          sessionId: `fake-session-${++sessionCounter}`,
          models: modelsPayload(),
        },
      });

const handlers = {
  initialize: (id) =>
    send({
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true, sse: true },
          promptCapabilities: { image: true },
        },
      },
    }),
  'session/new': async (id) => {
    if (process.env.FAKE_ACP_STALL_NEW) return;
    await sleep(Number(process.env.FAKE_ACP_NEW_DELAY_MS ?? 0));
    if (!throttleSetup(id, 'new')) newSession(id);
  },
  'session/load': async (id, params) => {
    if (process.env.FAKE_ACP_STALL_LOAD) return;
    await sleep(Number(process.env.FAKE_ACP_LOAD_DELAY_MS ?? 0));
    if (throttleSetup(id, 'load')) return;
    if (process.env.FAKE_ACP_FAIL_LOAD) {
      send({
        id,
        error: { code: -32602, message: 'Session not found' },
      });
      return;
    }
    update(params.sessionId, {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'replayed history' },
    });
    update(params.sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'replayed answer' },
    });
    send({ id, result: { models: modelsPayload() } });
  },
  'session/set_model': (id, params) =>
    process.env.FAKE_ACP_STALL_SET_MODEL
      ? undefined
      : process.env.FAKE_ACP_FAIL_SET_MODEL
        ? send({
            id,
            error: internalError(process.env.FAKE_ACP_FAIL_SET_MODEL),
          })
        : models.includes(params.modelId)
          ? send({ id, result: {} })
          : send({
              id,
              error: { code: -32602, message: 'Invalid model value' },
            }),
  'session/prompt': (id, params) => void runPrompt(id, params),
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  log(message);

  if (message.method === 'session/cancel') {
    cancelled.add(message.params.sessionId);
  } else if (message.method === undefined && serverReplies.has(message.id)) {
    serverReplies.get(message.id)(message.result);
  } else if (handlers[message.method]) {
    handlers[message.method](message.id, message.params);
  } else if (message.id !== undefined) {
    send({
      id: message.id,
      error: { code: -32601, message: 'Method not found' },
    });
  }
});
