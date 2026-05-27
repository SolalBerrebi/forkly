import { invoke } from "@tauri-apps/api/core";

export type TransportId = "claude-code" | "api";

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
  createdAt: number;
  updatedAt: number;
}

export interface ClaudeCodeStatus {
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
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

  detectClaudeCode: () =>
    invoke<ClaudeCodeStatus>("detect_claude_code"),

  autoTitle: (sessionId: string) =>
    invoke<string>("auto_title", { sessionId }),

  gitBranchFor: (cwd: string) =>
    invoke<string | null>("git_branch_for", { cwd }),

  listNetLog: (limit?: number) =>
    invoke<NetLogEntry[]>("list_net_log", { limit }),
  clearNetLog: () => invoke<void>("clear_net_log"),
};

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
