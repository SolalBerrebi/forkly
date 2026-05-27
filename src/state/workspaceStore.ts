import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export type SessionId = string;

export interface Session {
  id: SessionId;
  title: string;
  providerId: string;
  modelId: string;
  position: { x: number; y: number };
  parentSessionId: SessionId | null;
  forkPointMessageId: string | null;
  ownMessageIds: string[];
}

interface WorkspaceState {
  sessions: Record<SessionId, Session>;
  addSession: (init?: Partial<Session>) => SessionId;
  updateSessionPosition: (id: SessionId, position: { x: number; y: number }) => void;
  removeSession: (id: SessionId) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set) => ({
    sessions: {},
    addSession: (init = {}) => {
      const id = crypto.randomUUID();
      set((state) => {
        state.sessions[id] = {
          id,
          title: init.title ?? "untitled session",
          providerId: init.providerId ?? "anthropic",
          modelId: init.modelId ?? "claude-sonnet-4-6",
          position: init.position ?? { x: 0, y: 0 },
          parentSessionId: init.parentSessionId ?? null,
          forkPointMessageId: init.forkPointMessageId ?? null,
          ownMessageIds: init.ownMessageIds ?? [],
        };
      });
      return id;
    },
    updateSessionPosition: (id, position) => {
      set((state) => {
        const session = state.sessions[id];
        if (session) session.position = position;
      });
    },
    removeSession: (id) => {
      set((state) => {
        delete state.sessions[id];
      });
    },
  })),
);
