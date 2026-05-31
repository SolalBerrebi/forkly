import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  ipc,
  type Session as IpcSession,
  type TransportId,
  type Workspace as IpcWorkspace,
} from "../lib/ipc";
import { autoLayout } from "../canvas/layout/autoLayout";
import { getPreferredProvider } from "../lib/preferredProvider";
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
  width: number | null;
  height: number | null;
  positionLocked: boolean;
  /** True when the session is currently expanded — width/height reflect the
   *  expanded preset, preExpand* hold the size to restore on collapse. */
  preExpandWidth: number | null;
  preExpandHeight: number | null;
  /** Per-cell appearance override; null means "follow global Settings". */
  appearanceOverride: "terminal" | "chat" | null;
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
    width: s.width,
    height: s.height,
    positionLocked: s.positionLocked > 0,
    preExpandWidth: s.preExpandWidth,
    preExpandHeight: s.preExpandHeight,
    appearanceOverride:
      s.appearanceOverride === "terminal" || s.appearanceOverride === "chat"
        ? s.appearanceOverride
        : null,
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
    /** Optional override: fork into a different provider/model/transport.
     *  When unset, inherits from the parent (same behaviour as before). The
     *  cross-LLM fork picker uses this to spawn a Claude→GPT or Claude→Gemini
     *  chain from one click. */
    providerOverride?: {
      providerId: string;
      modelId: string;
      transportId: TransportId;
    },
  ) => Promise<SessionId>;
  fanOut: (
    parentSessionId: SessionId,
    anchorMessageId: string,
    count: number,
  ) => Promise<SessionId[]>;
  /** Spawn one fork per available provider, rebroadcasting the same prompt
   *  to all of them. The "killer demo" — Claude + GPT + Gemini (+ Ollama)
   *  responding to the same context in parallel, each tinted with its own
   *  brand color on the canvas. Returns the new session ids. */
  fanOutAcrossProviders: (
    parentSessionId: SessionId,
    anchorMessageId: string,
    providers: ReadonlyArray<{
      providerId: string;
      modelId: string;
      transportId: TransportId;
    }>,
  ) => Promise<SessionId[]>;
  mergeSessions: (sourceSessionIds: SessionId[]) => Promise<SessionId>;
  updateSessionPosition: (id: SessionId, position: { x: number; y: number }) => void;
  /** Optimistic + debounced-persist resize. Same pattern as position. */
  updateSessionSize: (id: SessionId, width: number, height: number) => void;
  updateSessionTitle: (id: SessionId, title: string) => Promise<void>;
  updateSessionModel: (id: SessionId, modelId: string) => Promise<void>;
  /** Switch a session's provider (and optionally transport) along with model.
   *  Used when the user picks a model from a different family in the per-cell
   *  picker (e.g. Claude → GPT). Keeps DB writes atomic from the UI's POV. */
  updateSessionProviderModel: (
    id: SessionId,
    providerId: string,
    modelId: string,
    transportId: TransportId,
  ) => Promise<void>;
  /** Set the per-session appearance override, or pass `null` to clear it
   *  back to "follow global setting". */
  updateSessionAppearance: (
    id: SessionId,
    override: "terminal" | "chat" | null,
  ) => Promise<void>;
  /**
   * Toggle a session between its normal size and a generous expanded preset.
   * Backend stores the pre-expand size atomically, so collapse always returns
   * to whatever the session was before the user hit Expand.
   */
  toggleSessionExpanded: (id: SessionId) => Promise<void>;
  applyTitleFromBackend: (id: SessionId, title: string) => void;
  /**
   * Run dagre auto-layout on the current workspace's sessions. Honours
   * `positionLocked` — only emits position updates for unlocked nodes.
   * When `unlockAll` is true (the explicit "Reorganize" button), every node
   * is unlocked first so the whole tree snaps to a clean layout.
   */
  reorganizeCurrentWorkspace: (unlockAll?: boolean) => void;
  /**
   * Import an existing Claude Code session from ~/.claude/projects/ live-linked
   * — the Forkly session reuses the CC session UUID so future turns
   * --resume the same underlying file. Returns the new session id.
   */
  importCcSession: (
    projectDir: string,
    sessionId: string,
    position: { x: number; y: number },
  ) => Promise<SessionId>;
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
const sizePersistTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();

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
      // Drop the leaving workspace's cached messages so the store doesn't grow
      // across switches; sessions re-hydrate from the DB on demand.
      useMessagesStore.getState().purgeAll();
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
      // Drop cached messages so a deleted workspace's sessions don't linger.
      useMessagesStore.getState().purgeAll();
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
      // Respect explicit init values; otherwise fall back to the user's
      // onboarding choice (stored in localStorage), then to Claude Code
      // hard-defaults so this still works pre-onboarding.
      const pref = getPreferredProvider();
      const created = await ipc.createSession({
        providerId: init.providerId ?? pref?.providerId ?? "anthropic",
        modelId: init.modelId ?? pref?.modelId ?? "claude-sonnet-4-6",
        transportId: init.transportId ?? pref?.transportId ?? "claude-code",
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

    forkSession: async (parentId, forkPointMessageId, position, providerOverride) => {
      const parent = get().sessions[parentId];
      if (!parent) {
        throw new Error(`fork: parent session ${parentId} not in store`);
      }
      const pos = position ?? {
        x: parent.position.x + 420,
        y: parent.position.y + 60 + (Math.random() - 0.5) * 80,
      };
      const created = await ipc.createSession({
        providerId: providerOverride?.providerId ?? parent.providerId,
        modelId: providerOverride?.modelId ?? parent.modelId,
        transportId: providerOverride?.transportId ?? parent.transportId,
        workspaceId: parent.workspaceId,
        title: providerOverride
          ? `fork → ${providerOverride.providerId}`
          : "fork",
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

    fanOutAcrossProviders: async (parentSessionId, anchorMessageId, providers) => {
      if (providers.length < 1) {
        throw new Error("cross-provider fan-out needs at least 1 provider");
      }

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

      // Walk backwards from the anchor to find the most recent user message —
      // that's the prompt we'll rebroadcast. Same logic as fanOut().
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

      // Lay forks out in a vertical column to the right of the parent so the
      // user sees them as a fan. Spacing matches single-provider fanOut.
      const baseX = parent.position.x + 460;
      const spacing = 520;
      const count = providers.length;
      const positions = providers.map((_, i) => ({
        x: baseX,
        y: parent.position.y + (i - (count - 1) / 2) * spacing,
      }));

      // Create all sessions in parallel — each in its own provider/model/transport.
      const created = await Promise.all(
        providers.map((p, i) =>
          ipc.createSession({
            providerId: p.providerId,
            modelId: p.modelId,
            transportId: p.transportId,
            workspaceId: parent.workspaceId,
            title: `fork → ${p.providerId}`,
            positionX: positions[i].x,
            positionY: positions[i].y,
            parentSessionId,
            forkPointMessageId: forkPointId,
          }),
        ),
      );

      set((state) => {
        for (const c of created) state.sessions[c.id] = fromIpc(c);
      });

      // Kick off every stream in parallel. The backend dispatches per-session
      // so each provider streams independently — Claude, GPT, Gemini, Ollama
      // all racing on the canvas, each tinted with its own brand color.
      for (const fork of created) {
        ipc.startStream(fork.id, promptText).catch((err) => {
          console.error(`cross-provider fan-out to ${fork.id} failed`, err);
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
        if (s) {
          s.position = position;
          // A drag from the user counts as a lock — auto-layout will leave
          // this node alone going forward until they explicitly unlock via
          // the Reorganize button.
          s.positionLocked = true;
        }
      });

      const existing = positionPersistTimers.get(id);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => {
        positionPersistTimers.delete(id);
        ipc
          .updateSession(id, {
            positionX: position.x,
            positionY: position.y,
            positionLocked: 1,
          })
          .catch((err) => console.error("position persist failed", err));
      }, 200);
      positionPersistTimers.set(id, handle);
    },

    importCcSession: async (projectDir, sessionId, position) => {
      const created = await ipc.importCcSession({
        projectDir,
        sessionId,
        workspaceId: get().currentWorkspaceId,
        positionX: position.x,
        positionY: position.y,
      });
      set((state) => {
        state.sessions[created.id] = fromIpc(created);
      });
      // Re-hydrate the imported session's messages so the canvas shows
      // the conversation immediately. Fire-and-forget; the chat opens
      // empty for a frame, then populates.
      useMessagesStore
        .getState()
        .hydrateForSession(created.id)
        .catch((err) => console.error("hydrate imported session failed", err));
      return created.id;
    },

    reorganizeCurrentWorkspace: (unlockAll = false) => {
      const state = get();
      const currentWs = state.currentWorkspaceId;
      const sessions = Object.values(state.sessions).filter(
        (s) => s.workspaceId === currentWs,
      );
      if (sessions.length === 0) return;

      const locked = new Set<SessionId>();
      if (!unlockAll) {
        for (const s of sessions) {
          if (s.positionLocked) locked.add(s.id);
        }
      }

      const { positions } = autoLayout(sessions, locked);

      set((draft) => {
        for (const [sid, pos] of Object.entries(positions)) {
          const s = draft.sessions[sid];
          if (s) {
            s.position = pos;
            if (unlockAll) s.positionLocked = false;
          }
        }
      });

      // Persist new positions (and the unlocked flag if applicable). Fire
      // and forget; each call is independent.
      for (const [sid, pos] of Object.entries(positions)) {
        ipc
          .updateSession(sid, {
            positionX: pos.x,
            positionY: pos.y,
            ...(unlockAll ? { positionLocked: 0 } : {}),
          })
          .catch((err) => console.error("reorganize persist failed", err));
      }
    },

    updateSessionSize: (id, width, height) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) {
          s.width = width;
          s.height = height;
        }
      });
      const existing = sizePersistTimers.get(id);
      if (existing) clearTimeout(existing);
      const handle = setTimeout(() => {
        sizePersistTimers.delete(id);
        ipc.updateSession(id, { width, height }).catch((err) =>
          console.error("size persist failed", err),
        );
      }, 200);
      sizePersistTimers.set(id, handle);
    },

    updateSessionTitle: async (id, title) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.title = title;
      });
      await ipc.updateSession(id, { title });
    },

    updateSessionModel: async (id, modelId) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.modelId = modelId;
      });
      await ipc.updateSession(id, { modelId });
    },

    updateSessionProviderModel: async (id, providerId, modelId, transportId) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) {
          s.providerId = providerId;
          s.modelId = modelId;
          s.transportId = transportId;
        }
      });
      await ipc.updateSession(id, { providerId, modelId, transportId });
    },

    updateSessionAppearance: async (id, override) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.appearanceOverride = override;
      });
      // Empty string is the sentinel the backend uses to clear back to NULL.
      await ipc.updateSession(id, { appearanceOverride: override ?? "" });
    },

    toggleSessionExpanded: async (id) => {
      const s = get().sessions[id];
      if (!s) return;
      const isExpanded =
        s.preExpandWidth !== null && s.preExpandHeight !== null;
      const updated = isExpanded
        ? await ipc.collapseSession(id)
        : await ipc.expandSession(id);
      set((state) => {
        state.sessions[updated.id] = fromIpc(updated);
      });
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
      // Drop this session's cached messages/streaming flags so they don't
      // linger in the store after the node is gone.
      useMessagesStore.getState().purgeSession(id);
      await ipc.deleteSession(id);
    },
  })),
);
