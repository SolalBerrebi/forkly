import { invoke } from "@tauri-apps/api/core";

export type TransportId = "claude-code" | "api" | "codex" | "ollama";

export interface Workspace {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  transportId: TransportId;
  systemPrompt: string | null;
  positionX: number;
  positionY: number;
  parentSessionId: string | null;
  forkPointMessageId: string | null;
  /** JSON-encoded array of source session ids for merge nodes, NULL otherwise. */
  mergeSourceSessionIds: string | null;
  workspaceId: string | null;
  inputTokensTotal: number;
  outputTokensTotal: number;
  lastActivityAt: number | null;
  workingDir: string | null;
  width: number | null;
  height: number | null;
  positionLocked: number;
  preExpandWidth: number | null;
  preExpandHeight: number | null;
  /** "terminal" | "chat" | null. NULL means "follow global setting". */
  appearanceOverride: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ClaudeCodeStatus {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
}

export interface OllamaModel {
  id: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export interface OllamaStatus {
  running: boolean;
  models: OllamaModel[];
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  position: number;
  createdAt: number;
}

export interface CreateSessionInput {
  title?: string;
  providerId: string;
  modelId: string;
  transportId?: TransportId;
  workspaceId?: string;
  systemPrompt?: string;
  positionX?: number;
  positionY?: number;
  parentSessionId?: string;
  forkPointMessageId?: string;
}

export interface UpdateSessionInput {
  title?: string;
  providerId?: string;
  modelId?: string;
  transportId?: TransportId;
  systemPrompt?: string;
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  positionLocked?: number;
  /** "" clears (back to follow-global), "terminal" or "chat" sets the override. */
  appearanceOverride?: string;
}

export const ipc = {
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  createWorkspace: (name: string) =>
    invoke<Workspace>("create_workspace", { name }),
  renameWorkspace: (id: string, name: string) =>
    invoke<Workspace>("rename_workspace", { id, name }),
  deleteWorkspace: (id: string) =>
    invoke<string[]>("delete_workspace", { id }),

  listSessions: (workspaceId?: string) =>
    invoke<Session[]>("list_sessions", { workspaceId }),
  createSession: (input: CreateSessionInput) =>
    invoke<Session>("create_session", { input }),
  updateSession: (id: string, patch: UpdateSessionInput) =>
    invoke<Session>("update_session", { id, patch }),
  mergeSessions: (
    sourceSessionIds: string[],
    positionX: number,
    positionY: number,
  ) =>
    invoke<Session>("merge_sessions", {
      sourceSessionIds,
      positionX,
      positionY,
    }),
  expandSession: (id: string) => invoke<Session>("expand_session", { id }),
  collapseSession: (id: string) => invoke<Session>("collapse_session", { id }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),

  listMessages: (sessionId: string) =>
    invoke<Message[]>("list_messages", { sessionId }),

  hasApiKey: (provider: string) =>
    invoke<boolean>("has_api_key", { provider }),
  setApiKey: (provider: string, key: string) =>
    invoke<void>("set_api_key", { provider, key }),
  deleteApiKey: (provider: string) =>
    invoke<void>("delete_api_key", { provider }),

  startStream: (sessionId: string, userMessage: string) =>
    invoke<void>("start_stream", { sessionId, userMessage }),
  stopStream: (sessionId: string) => invoke<void>("stop_stream", { sessionId }),

  detectClaudeCode: () =>
    invoke<ClaudeCodeStatus>("detect_claude_code"),
  detectCodex: () =>
    invoke<ClaudeCodeStatus>("detect_codex"),
  detectOllama: () =>
    invoke<OllamaStatus>("detect_ollama"),
  /**
   * Open the user's default terminal with the given shell script pre-typed.
   * The user reviews and hits enter — we don't auto-execute. Used by
   * onboarding so install + login flows are one click instead of "copy
   * this command, switch apps, paste, hit enter."
   */
  runInTerminal: (script: string) =>
    invoke<void>("run_in_terminal", { script }),

  autoTitle: (sessionId: string) =>
    invoke<string>("auto_title", { sessionId }),

  gitBranchFor: (cwd: string) =>
    invoke<string | null>("git_branch_for", { cwd }),

  listNetLog: (limit?: number) =>
    invoke<NetLogEntry[]>("list_net_log", { limit }),
  clearNetLog: () => invoke<void>("clear_net_log"),

  listCcProjects: () => invoke<CcProject[]>("list_cc_projects"),
  listCcSessions: (projectDir: string) =>
    invoke<CcSessionSummary[]>("list_cc_sessions", { projectDir }),
  importCcSession: (input: ImportCcSessionInput) =>
    invoke<Session>("import_cc_session", { input }),
};

export interface CcProject {
  encodedDir: string;
  cwd: string | null;
  displayName: string;
  sessionCount: number;
  lastActivityMs: number;
}

export interface CcSessionSummary {
  sessionId: string;
  lastActivityMs: number;
  messageCount: number;
  firstUserMessage: string | null;
  modelId: string | null;
}

export interface ImportCcSessionInput {
  projectDir: string;
  sessionId: string;
  workspaceId: string;
  positionX: number;
  positionY: number;
}

export interface NetLogEntry {
  id: string;
  timestampMs: number;
  transport: string;
  method: string;
  status: string;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sessionId: string | null;
  detail: string | null;
}

export interface SessionStatsPayload {
  sessionId: string;
  inputTokensTotal: number;
  outputTokensTotal: number;
  lastActivityAt: number;
}

// Tauri events emitted from start_stream.
export interface StreamStartPayload {
  sessionId: string;
  userMessage: Message;
  assistantMessage: Message;
}

export interface StreamDeltaPayload {
  sessionId: string;
  assistantMessageId: string;
  delta: string;
}

export interface StreamDonePayload {
  sessionId: string;
  assistantMessageId: string;
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface StreamErrorPayload {
  sessionId: string;
  assistantMessageId: string | null;
  error: string;
}
