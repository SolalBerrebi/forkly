import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { ipc, type Session as IpcSession, type TransportId } from "../lib/ipc";
import { useMessagesStore } from "./messagesStore";

export type SessionId = string;

export interface Session {
  id: SessionId;
  title: string;
  providerId: string;
  modelId: string;
  transportId: TransportId;
  position: { x: number; y: number };
  parentSessionId: SessionId | null;
  forkPointMessageId: string | null;
}

export interface AddSessionInput {
  title?: string;
  providerId?: string;
  modelId?: string;
  transportId?: TransportId;
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
    transportId: s.transportId,
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
  forkSession: (
    parentId: SessionId,
    forkPointMessageId: string,
    position?: { x: number; y: number },
  ) => Promise<SessionId>;
  /**
   * Spawn N sibling forks from the user-message anchor at or before
   * `anchorMessageId`, place them in a vertical fan to the right of the
   * parent, and immediately broadcast the user message to each so all N
   * stream in parallel. Returns the ids of the new fork sessions.
   */
  fanOut: (
    parentSessionId: SessionId,
    anchorMessageId: string,
    count: number,
  ) => Promise<SessionId[]>;
  updateSessionPosition: (id: SessionId, position: { x: number; y: number }) => void;
  updateSessionTitle: (id: SessionId, title: string) => Promise<void>;
  /** Local-only title set — used when the backend has already persisted the
   *  new title (e.g., after the auto-titling command). Avoids a redundant
   *  round-trip back to the DB. */
  applyTitleFromBackend: (id: SessionId, title: string) => void;
  removeSession: (id: SessionId) => Promise<void>;
}

const positionPersistTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
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
        transportId: init.transportId ?? "claude-code",
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
      // Read the parent from local state — its provider / model / transport
      // / system prompt all get inherited by the fork. The frontend is
      // authoritative for placement; the backend just stores what we send.
      const parent = get().sessions[parentId];
      if (!parent) {
        throw new Error(`fork: parent session ${parentId} not in store`);
      }

      // Default placement: just to the right of the parent + small Y jitter.
      const pos = position ?? {
        x: parent.position.x + 420,
        y: parent.position.y + 60 + (Math.random() - 0.5) * 80,
      };

      const created = await ipc.createSession({
        providerId: parent.providerId,
        modelId: parent.modelId,
        transportId: parent.transportId,
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

      // Reach into messagesStore to determine the user prompt to broadcast
      // and the fork point (= the message *before* that user message, so
      // each fork inherits parent context up to but not including the prompt).
      const msgs = useMessagesStore.getState();
      const ids = msgs.bySession[parentSessionId] ?? [];
      const anchorIdx = ids.indexOf(anchorMessageId);
      if (anchorIdx === -1) {
        throw new Error("fan-out: anchor message not in session");
      }

      // Walk back to find the user message at or before the anchor.
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

      // Vertical fan layout: forks centered around parent.y, spaced so the
      // 480px node height leaves a comfortable gap between siblings.
      const baseX = parent.position.x + 460;
      const spacing = 520;
      const positions = Array.from({ length: count }, (_, i) => ({
        x: baseX,
        y: parent.position.y + (i - (count - 1) / 2) * spacing,
      }));

      // Create all N forks in parallel.
      const created = await Promise.all(
        positions.map((pos) =>
          ipc.createSession({
            providerId: parent.providerId,
            modelId: parent.modelId,
            transportId: parent.transportId,
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

      // Broadcast the user prompt to every new fork — they all stream their
      // own variant in parallel. Failures here surface via the stream:error
      // event, so we don't await individually.
      for (const fork of created) {
        ipc.startStream(fork.id, promptText).catch((err) => {
          console.error(`fan-out broadcast to ${fork.id} failed`, err);
        });
      }

      return created.map((c) => c.id);
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

    applyTitleFromBackend: (id, title) => {
      set((state) => {
        const s = state.sessions[id];
        if (s) s.title = title;
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
