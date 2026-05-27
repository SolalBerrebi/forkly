import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { ipc, type Message } from "../lib/ipc";

interface MessagesState {
  /** All messages indexed by id. Source of truth. */
  byId: Record<string, Message>;
  /** Ordered message id arrays per session. */
  bySession: Record<string, string[]>;
  /** Messages currently being streamed (their assistant message id). */
  streaming: Record<string, true>;
  /** Sessions that currently have ANY streaming message. Maintained separately
   *  from `streaming` so canvas consumers (ForkCanvas edges) can subscribe to
   *  start/stop transitions only, not to every token delta — otherwise edges
   *  recompute hundreds of times per second during streaming and React hits
   *  its infinite-render guard. */
  streamingSessions: Record<string, true>;
  /** Per-message error strings, if any. */
  errors: Record<string, string>;
  /** Sessions whose messages we've already fetched. Plain Record (not Set)
   *  because Immer doesn't support Set/Map without `enableMapSet()`, and a
   *  Set inside Immer would also break Zustand's snapshot caching → React
   *  "Maximum update depth exceeded" → renderer crash. */
  hydratedSessions: Record<string, true>;

  hydrateForSession: (sessionId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  appendDelta: (assistantMessageId: string, delta: string) => void;
  finishStream: (assistantMessageId: string, content: string) => void;
  failStream: (assistantMessageId: string | null, sessionId: string, error: string) => void;
}

export const useMessagesStore = create<MessagesState>()(
  immer((set) => ({
    byId: {},
    bySession: {},
    streaming: {},
    streamingSessions: {},
    errors: {},
    hydratedSessions: {},

    hydrateForSession: async (sessionId) => {
      const rows = await ipc.listMessages(sessionId);
      set((state) => {
        state.bySession[sessionId] = [];
        for (const m of rows) {
          state.byId[m.id] = m;
          state.bySession[sessionId].push(m.id);
        }
        state.hydratedSessions[sessionId] = true;
      });
    },

    addMessage: (message) => {
      set((state) => {
        state.byId[message.id] = message;
        const list = state.bySession[message.sessionId] ?? [];
        if (!list.includes(message.id)) list.push(message.id);
        state.bySession[message.sessionId] = list;
        if (message.role === "assistant" && message.content === "") {
          state.streaming[message.id] = true;
          state.streamingSessions[message.sessionId] = true;
        }
        delete state.errors[message.id];
      });
    },

    appendDelta: (assistantMessageId, delta) => {
      set((state) => {
        const msg = state.byId[assistantMessageId];
        if (msg) msg.content += delta;
      });
    },

    finishStream: (assistantMessageId, content) => {
      set((state) => {
        const msg = state.byId[assistantMessageId];
        if (msg) msg.content = content;
        delete state.streaming[assistantMessageId];
        if (msg) {
          // Only drop the session-level streaming flag if no OTHER message in
          // the same session is still streaming (would matter for tool-call
          // workflows later; harmless today).
          const sessionId = msg.sessionId;
          const sessionMsgIds = state.bySession[sessionId] ?? [];
          const anyStillStreaming = sessionMsgIds.some(
            (id) => id !== assistantMessageId && !!state.streaming[id],
          );
          if (!anyStillStreaming) {
            delete state.streamingSessions[sessionId];
          }
        }
      });
    },

    failStream: (assistantMessageId, sessionId, error) => {
      set((state) => {
        if (assistantMessageId) {
          delete state.streaming[assistantMessageId];
          state.errors[assistantMessageId] = error;
        }
        delete state.streamingSessions[sessionId];
      });
    },
  })),
);
