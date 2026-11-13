export type AcpToolContent =
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: string };

/** The slice of ACP `session/update` payloads the harness reads. */
export interface AcpSessionUpdate {
  sessionUpdate: string;
  /** A text block for message chunks; a block list for tool call updates. */
  content?: { type?: string; text?: string } | AcpToolContent[];
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    /** MCP tools report a structured result instead, e.g. `{ success: true }`. */
    [key: string]: unknown;
  };
  entries?: Array<{ content: string; priority?: string; status?: string }>;
}

export interface AcpModelInfo {
  modelId: string;
  name?: string;
}

/** Shared shape of the `session/new` and `session/load` results we read. */
export interface AcpSessionResult {
  sessionId?: string;
  models?: { currentModelId?: string; availableModels?: AcpModelInfo[] };
}

export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export interface AcpMcpServer {
  type?: 'http' | 'sse';
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Array<{ name: string; value: string }>;
  headers?: Array<{ name: string; value: string }>;
}

export interface CursorLog {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface CursorSessionOptions {
  workspacePath: string;
  mcpServers: AcpMcpServer[];
  /** Model name as Roomote knows it, e.g. `composer-2.5`. */
  requestedModel?: string;
  /** Bounds `session/new` and `session/set_model`. */
  requestTimeoutMs: number;
  /** Bounds `session/load`, which replays the whole history. */
  loadTimeoutMs: number;
  /** Waits before each retry of a rate-limited setup request. */
  rateLimitBackoffMs: readonly number[];
  log: CursorLog;
}
