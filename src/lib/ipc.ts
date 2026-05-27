import { invoke } from "@tauri-apps/api/core";

export type TransportId = "claude-code" | "api";

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
}

export const ipc = {
  listSessions: () => invoke<Session[]>("list_sessions"),
  createSession: (input: CreateSessionInput) =>
    invoke<Session>("create_session", { input }),
  updateSession: (id: string, patch: UpdateSessionInput) =>
    invoke<Session>("update_session", { id, patch }),
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
};

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
