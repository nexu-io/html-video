/**
 * Runtime types — slim variant of OD's RuntimeAgentDef.
 * v0.1: only the fields html-video needs to spawn + read stdout.
 * Future expansion (prompt-budget, stream-json, MCP) lands per-need.
 */

export interface AgentDef {
  /** Stable id — `claude` / `cursor-agent` / `codex` / `opencode` / `anthropic-api` etc */
  id: string;
  /** Human label */
  name: string;
  /** CLI binary name (looked up via PATH). For `kind: "http"` agents this is a
   *  pseudo name that doctor() displays but never spawns — set it to something
   *  recognisable like "anthropic-api". */
  bin: string;
  /** Absolute-path fallbacks tried (in order) when `bin` is not on PATH.
   *  Used for agents shipped inside another app bundle — e.g. AMR's `vela`
   *  lives in Open Design.app, not on PATH. List real candidate paths; the
   *  first existing one wins and is used as the spawn binary. */
  binFallbacks?: string[];
  /** Last-resort async binary resolver, tried after PATH + binFallbacks miss.
   *  Lets an agent pull its binary from a bundled npm package (e.g. AMR resolves
   *  `vela` via @powerformer/vela-cli, which ships per-platform binaries) so the
   *  product works without any external install. Return an absolute path or null. */
  resolveBinFallback?: () => Promise<string | null>;
  /** Args to print version (used in `doctor`). Ignored for http agents. */
  versionArgs: string[];
  /** Build the argv list given the user prompt. Ignored for http agents. */
  buildArgs(prompt: string, ctx: AgentInvokeContext): string[];
  /**
   * How agent emits to stdout:
   * - `plain`: free-form text (everything printed is output)
   * - `claude-stream`: claude --output-format stream-json (NDJSON wrapped events)
   * - `json-event-stream`: NDJSON {type, ...} event stream
   * - `acp-json-rpc`: bidirectional ACP JSON-RPC over stdio (AMR/vela). Spawn
   *   stays open; we drive initialize → session/new → session/prompt and read
   *   streamed session/update notifications. Handled by a dedicated path.
   */
  streamFormat: 'plain' | 'claude-stream' | 'json-event-stream' | 'acp-json-rpc';
  /** Pass prompt via stdin instead of argv (recommended for long prompts) */
  promptViaStdin?: boolean;
  /**
   * Optional extra availability gate run AFTER the binary is found (child
   * agents only). Lets an agent report "installed but not usable" — e.g. AMR
   * is on disk but the user isn't logged in. Return available=false + a hint.
   * `resolvedBin` is the path that detection settled on (PATH or a fallback).
   */
  extraDetect?: (resolvedBin: string) => Promise<{ available: boolean; version?: string | null; hint?: string }>;
  /** Extra fixed env vars on spawn */
  env?: Record<string, string>;
  /** Where to find install instructions */
  installUrl?: string;
  /**
   * Runtime kind (default `child`).
   *   - `child`: spawn `bin` as a child process (the v0.1 behaviour)
   *   - `http`: skip spawn, call `httpHandler` instead. Used for direct
   *     API agents (e.g. Anthropic Messages, OpenAI ChatCompletions).
   */
  kind?: 'child' | 'http';
  /**
   * For `kind: "http"` agents — performs the request and streams events.
   * Should never throw; instead emit `{ type: 'error', message }` and finish
   * with `{ type: 'message_end' }`.
   */
  httpHandler?: (
    prompt: string,
    ctx: AgentInvokeContext,
    onEvent: (e: import('./types.js').AgentEvent) => void,
    abortSignal: AbortSignal,
  ) => Promise<{ exitCode: number }>;
  /**
   * Whether the http agent is configured / reachable. Used by doctor() in
   * place of a `which`/`--version` probe. Returns `{ available, error?, hint? }`.
   */
  httpProbe?: () => Promise<{ available: boolean; version?: string | null; hint?: string }>;
}

export interface AgentInvokeContext {
  cwd: string;
  /** Allowed working dirs (e.g. project's .html-video/projects/<id>/) */
  extraAllowedDirs?: string[];
}

export interface DetectedAgent {
  id: string;
  name: string;
  bin: string;
  available: boolean;
  path?: string;
  version?: string | null;
  installUrl?: string;
  /** Why it's unavailable / what to do — e.g. AMR found but not logged in. */
  hint?: string;
}

export type AgentEvent =
  | { type: 'text'; chunk: string }
  | { type: 'tool_use'; tool: string; input: unknown; id?: string }
  | { type: 'tool_result'; id?: string; output: unknown; isError?: boolean }
  | { type: 'message_end'; reason?: string }
  | { type: 'error'; message: string };

export interface SpawnHandle {
  pid: number;
  stop(): void;
  done: Promise<{ exitCode: number; signal: NodeJS.Signals | null }>;
}
