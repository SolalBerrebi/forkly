import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  ipc,
  type Session as IpcSession,
  type TransportId,
  type Workspace as IpcWorkspace,
} from "../lib/ipc";
import { useMessagesStore } from "./messagesStore";

export type SessionId = string;
export type WorkspaceId = string;

const DEFAULT_WORKSPACE_ID = "default";
const LAST_WORKSPACE_KEY = "forkly:last-workspace";

export interface Workspace {
  id: WorkspaceId;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: SessionId;
  title: string;
  providerId: string;
  modelId: string;
  transportId: TransportId;
  position: { x: number; y: number };
  parentSessionId: SessionId | null;
  forkPointMessageId: string | null;
  /** Decoded list of source session ids — empty for non-merge sessions. */
  mergeSourceSessionIds: SessionId[];
  workspaceId: WorkspaceId;
  inputTokensTotal: number;
  outputTokensTotal: number;
  lastActivityAt: number | null;
  workingDir: string | null;
}

export interface AddSessionInput {
  title?: string;
  providerId?: string;
  modelId?: string;
  transportId?: TransportId;
  workspaceId?: WorkspaceId;
  systemPrompt?: string;
  position?: { x: number; y: number };
  parentSessionId?: SessionId | null;
  forkPointMessageId?: string | null;
}

function fromIpc(s: IpcSession): Session {
  let mergeSourceSessionIds: SessionId[] = [];
  if (s.mergeSourceSessionIds) {
    try {
      const parsed = JSON.parse(s.mergeSourceSessionIds);
      if (Array.isArray(parsed)) mergeSourceSessionIds = parsed as SessionId[];
    } catch {
      // ignore malformed JSON — treat as non-merge
    }
  }
  return {
    id: s.id,
    title: s.title,
    providerId: s.providerId,
    modelId: s.modelId,
    transportId: s.transportId,
    position: { x: s.positionX, y: s.positionY },
    parentSessionId: s.parentSessionId,
    forkPointMessageId: s.forkPointMessageId,
    mergeSourceSessionIds,
    workspaceId: s.workspaceId ?? DEFAULT_WORKSPACE_ID,
    inputTokensTotal: s.inputTokensTotal,
    outputTokensTotal: s.outputTokensTotal,
    lastActivityAt: s.lastActivityAt,
    workingDir: s.workingDir,
  };
}

function fromIpcWorkspace(w: IpcWorkspace): Workspace {
  return {
    id: w.id,
    name: w.name,
    sortOrder: w.sortOrder,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

interface WorkspaceState {
  // ----- workspaces ("pages / sheets") -----
  workspacesById: Record<WorkspaceId, Workspace>;
  currentWorkspaceId: WorkspaceId;

  // ----- sessions (canvas nodes) -----
  sessions: Record<SessionId, Session>;
  isHydrated: boolean;
  hydrationError: string | null;

  hydrate: () => Promise<void>;

  switchWorkspace: (id: WorkspaceId) => void;
  createWorkspace: (name: string) => Promise<WorkspaceId>;
  renameWorkspace: (id: WorkspaceId, name: string) => Promise<void>;
  deleteWorkspace: (id: WorkspaceId) => Promise<void>;

  addSession: (init?: AddSessionInput) => Promise<SessionId>;
  forkSession: (
    parentId: SessionId,
    forkPointMessageId: string,
    position?: { x: number; y: number },
  ) => Promise<SessionId>;
  fanOut: (
    parentSessionId: SessionId,
    anchorMessageId: string,
    count: number,
  ) => Promise<SessionId[]>;
  mergeSessions: (sourceSessionIds: SessionId[]) => Promise<SessionId>;
  updateSessionPosition: (id: SessionId, position: { x: number; y: number }) => void;
  updateSessionTitle: (id: SessionId, title: string) => Promise<void>;
  applyTitleFromBackend: (id: SessionId, title: string) => void;
  /** Apply per-session stats coming from the backend's session:stats event.
   *  Updates input/output token totals + lastActivityAt without a re-list. */
  applySessionStats: (
    id: SessionId,
    inputTokensTotal: number,
    outputTokensTotal: number,
    lastActivityAt: number,
  ) => void;
  removeSession: (id: SessionId) => Promise<void>;
}

const positionPersistTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();

function readLastWorkspace(): WorkspaceId {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_ID;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? DEFAULT_WORKSPACE_ID;
}

function persistCurrentWorkspace(id: WorkspaceId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, id);
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspacesById: {},
    currentWorkspaceId: DEFAULT_WORKSPACE_ID,

    sessions: {},
    isHydrated: false,
    hydrationError: null,

    hydrate: async () => {
      try {
        // Workspaces first — `currentWorkspaceId` decides which sessions we
        // load. Restored from localStorage when possible, otherwise the
        // first workspace by sort order.
        const workspaces = await ipc.listWorkspaces();
        const last = readLastWorkspace();
        const chosen =
          workspaces.find((w) => w.id === last)?.id ??
          workspaces[0]?.id ??
          DEFAULT_WORKSPACE_ID;

        const sessions = await ipc.listSessions(chosen);

        set((state) => {
          state.workspacesById = {};
          for (const w of workspaces) {
            state.workspacesById[w.id] = fromIpcWorkspace(w);
          }
          state.currentWorkspaceId = chosen;
          state.sessions = {};
          for (const row of sessions) state.sessions[row.id] = fromIpc(row);
          state.isHydrated = true;
          state.hydrationError = null;
        });
        persistCurrentWorkspace(chosen);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set((state) => {
          state.isHydrated = true;
          state.hydrationError = msg;
        });
      }
    },

    switchWorkspace: (id) => {
      const target = get().workspacesById[id];
      if (!target) return;
      persistCurrentWorkspace(id);
      // Optimistic: clear sessions, then refetch for the new workspace. The
      // canvas blanks for a frame, then re-populates.
      set((state) => {
        state.currentWorkspaceId = id;
        state.sessions = {};
      });
      ipc.listSessions(id)
        .then((rows) => {
          set((state) => {
            for (const row of rows) state.sessions[row.id] = fromIpc(row);
          });
        })
        .catch((err) => console.error("switch workspace failed", err));
    },

    createWorkspace: async (name) => {
      const created = await ipc.createWorkspace(name);
      set((state) => {
        state.workspacesById[created.id] = fromIpcWorkspace(created);
        state.currentWorkspaceId = created.id;
        state.sessions = {}; // new workspace starts empty
      });
      persistCurrentWorkspace(created.id);
      return created.id;
    },

    renameWorkspace: async (id, name) => {
      const updated = await ipc.renameWorkspace(id, name);
      set((state) => {
        state.workspacesById[updated.id] = fromIpcWorkspace(updated);
      });
    },

    deleteWorkspace: async (id) => {
      const remaining = await ipc.deleteWorkspace(id);
      set((state) => {
        delete state.workspacesById[id];
        // If we just deleted the current workspace, switch to whatever the
        // backend reported as remaining (sorted), or DEFAULT as a last resort.
        if (state.currentWorkspaceId === id) {
          const next = remaining[0] ?? DEFAULT_WORKSPACE_ID;
          state.currentWorkspaceId = next;
          state.sessions = {};
          persistCurrentWorkspace(next);
        }
      });
      // Re-hydrate sessions for the (possibly new) current workspace.
      const cur = get().currentWorkspaceId;
      try {
        const rows = await ipc.listSessions(cur);
        set((state) => {
          state.sessions = {};
          for (const row of rows) state.sessions[row.id] = fromIpc(row);
        });
      } catch (err) {
        console.error("post-delete session reload failed", err);
      }
    },

    addSession: async (init = {}) => {
      const created = await ipc.createSession({
        providerId: init.providerId ?? "anthropic",
        modelId: init.modelId ?? "claude-sonnet-4-6",
        transportId: init.transportId ?? "claude-code",
        workspaceId: init.workspaceId ?? get().currentWorkspaceId,
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

    forkSession: async (parentId, forkPointMessageId, position) => {
      const parent = get().sessions[parentId];
      if (!parent) {
        throw new Error(`fork: parent session ${parentId} not in store`);
      }
      const pos = position ?? {
        x: parent.position.x + 420,
        y: parent.position.y + 60 + (Math.random() - 0.5) * 80,
      };
      const created = await ipc.createSession({
        providerId: parent.providerId,
        modelId: parent.modelId,
        transportId: parent.transportId,
        workspaceId: parent.workspaceId,
        title: "fork",
        positionX: pos.x,
        positionY: pos.y,
        parentSessionId: parentId,
        forkPointMessageId,
      });
      set((state) => {
        state.sessions[created.id] = fromIpc(created);
      });
      return created.id;
    },

    fanOut: async (parentSessionId, anchorMessageId, count) => {
      if (count < 1) throw new Error("fan-out count must be >= 1");

      const parent = get().sessions[parentSessionId];
      if (!parent) {
        throw new Error(`fan-out: parent ${parentSessionId} not in store`);
      }

      const msgs = useMessagesStore.getState();
      const ids = msgs.bySession[parentSessionId] ?? [];
      const anchorIdx = ids.indexOf(anchorMessageId);
      if (anchorIdx === -1) {
        throw new Error("fan-out: anchor message not in session");
      }

      let userIdx = anchorIdx;
      while (userIdx >= 0 && msgs.byId[ids[userIdx]]?.role !== "user") {
        userIdx -= 1;
      }
      if (userIdx < 0) {
        throw new Error("fan-out: no user message at or before anchor");
      }

      const userMessage = msgs.byId[ids[userIdx]];
      if (!userMessage) throw new Error("fan-out: anchor user message missing");

      const forkPointId = userIdx > 0 ? ids[userIdx - 1] : undefined;
      const promptText = userMessage.content;

      const baseX = parent.position.x + 460;
      const spacing = 520;
      const positions = Array.from({ length: count }, (_, i) => ({
        x: baseX,
        y: parent.position.y + (i - (count - 1) / 2) * spacing,
      }));

      const created = await Promise.all(
        positions.map((pos) =>
          ipc.createSession({
            providerId: parent.providerId,
            modelId: parent.modelId,
            transportId: parent.transportId,
            workspaceId: parent.workspaceId,
            title: "fork",
            positionX: pos.x,
            positionY: pos.y,
            parentSessionId,
            forkPointMessageId: forkPointId,
          }),
        ),
      );

      set((state) => {
        for (const c of created) state.sessions[c.id] = fromIpc(c);
      });

      for (const fork of created) {
        ipc.startStream(fork.id, promptText).catch((err) => {
          console.error(`fan-out broadcast to ${fork.id} failed`, err);
        });
      }

      return created.map((c) => c.id);
    },

    mergeSessions: async (sourceSessionIds) => {
      if (sourceSessionIds.length < 2) {
        throw new Error("merge needs at least 2 source sessions");
      }
      const sources = sourceSessionIds
        .map((id) => get().sessions[id])
        .filter((s): s is Session => !!s);
      if (sources.length < 2) {
        throw new Error("merge: not all source sessions are in store");
      }

      const maxX = Math.max(...sources.map((s) => s.position.x));
      const meanY = sources.reduce((a, s) => a + s.position.y, 0) / sources.length;
      const position = { x: maxX + 460, y: meanY };

      const created = await ipc.mergeSessions(
        sourceSessionIds,
        position.x,
        position.y,
      );

      set((state) => {
        state.sessions[created.id] = fromIpc(created);
      });

      ipc.startStream(created.id, "").catch((err) => {
        console.error("merge synthesis stream failed", err);
      });

      return created.id;
    },

    updateSessionPosition: (id, position) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.position = position;
      });

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

    applyTitleFromBackend: (id, title) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.title = title;
      });
    },

    applySessionStats: (id, inputTokensTotal, outputTokensTotal, lastActivityAt) => {
      set((state) => {
        const s = state.sessions[id];
        if (!s) return;
        s.inputTokensTotal = inputTokensTotal;
        s.outputTokensTotal = outputTokensTotal;
        s.lastActivityAt = lastActivityAt;
      });
    },

    removeSession: async (id) => {
      set((state) => {
        delete state.sessions[id];
      });
      await ipc.deleteSession(id);
    },
  })),
);
