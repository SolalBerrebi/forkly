import { invoke } from "@tauri-apps/api/core";

export interface Session {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  systemPrompt: string | null;
  positionX: number;
  positionY: number;
  parentSessionId: string | null;
  forkPointMessageId: string | null;
  createdAt: number;
  updatedAt: number;
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
};
