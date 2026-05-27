import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { ipc, type Session as IpcSession } from "../lib/ipc";

export type SessionId = string;

export interface Session {
  id: SessionId;
  title: string;
  providerId: string;
  modelId: string;
  position: { x: number; y: number };
  parentSessionId: SessionId | null;
  forkPointMessageId: string | null;
}

export interface AddSessionInput {
  title?: string;
  providerId?: string;
  modelId?: string;
  systemPrompt?: string;
  position?: { x: number; y: number };
  parentSessionId?: SessionId | null;
  forkPointMessageId?: string | null;
}

function fromIpc(s: IpcSession): Session {
  return {
    id: s.id,
    title: s.title,
    providerId: s.providerId,
    modelId: s.modelId,
    position: { x: s.positionX, y: s.positionY },
    parentSessionId: s.parentSessionId,
    forkPointMessageId: s.forkPointMessageId,
  };
}

interface WorkspaceState {
  sessions: Record<SessionId, Session>;
  isHydrated: boolean;
  hydrationError: string | null;

  hydrate: () => Promise<void>;
  addSession: (init?: AddSessionInput) => Promise<SessionId>;
  updateSessionPosition: (id: SessionId, position: { x: number; y: number }) => void;
  updateSessionTitle: (id: SessionId, title: string) => Promise<void>;
  removeSession: (id: SessionId) => Promise<void>;
}

const positionPersistTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set) => ({
    sessions: {},
    isHydrated: false,
    hydrationError: null,

    hydrate: async () => {
      try {
        const rows = await ipc.listSessions();
        set((state) => {
          state.sessions = {};
          for (const row of rows) state.sessions[row.id] = fromIpc(row);
          state.isHydrated = true;
          state.hydrationError = null;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set((state) => {
          state.isHydrated = true;
          state.hydrationError = msg;
        });
      }
    },

    addSession: async (init = {}) => {
      const created = await ipc.createSession({
        providerId: init.providerId ?? "anthropic",
        modelId: init.modelId ?? "claude-sonnet-4-6",
        title: init.title,
        systemPrompt: init.systemPrompt,
        positionX: init.position?.x,
        positionY: init.position?.y,
        parentSessionId: init.parentSessionId ?? undefined,
        forkPointMessageId: init.forkPointMessageId ?? undefined,
      });
      set((state) => {
        state.sessions[created.id] = fromIpc(created);
      });
      return created.id;
    },

    updateSessionPosition: (id, position) => {
      // Optimistic update for buttery dragging.
      set((state) => {
        const s = state.sessions[id];
        if (s) s.position = position;
      });

      // Debounced persist (drag fires many changes per second).
      const existing = positionPersistTimers.get(id);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => {
        positionPersistTimers.delete(id);
        ipc
          .updateSession(id, { positionX: position.x, positionY: position.y })
          .catch((err) => console.error("position persist failed", err));
      }, 200);
      positionPersistTimers.set(id, handle);
    },

    updateSessionTitle: async (id, title) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.title = title;
      });
      await ipc.updateSession(id, { title });
    },

    removeSession: async (id) => {
      set((state) => {
        delete state.sessions[id];
      });
      await ipc.deleteSession(id);
    },
  })),
);
