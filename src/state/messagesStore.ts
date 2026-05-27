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
      });
    },

    failStream: (assistantMessageId, sessionId, error) => {
      set((state) => {
        if (assistantMessageId) {
          delete state.streaming[assistantMessageId];
          state.errors[assistantMessageId] = error;
        } else {
          // No specific assistant message to attach to — surface under the session somehow.
          // For now, just log; UI can later show session-level errors.
          console.error(`stream error for session ${sessionId}: ${error}`);
        }
      });
    },
  })),
);
