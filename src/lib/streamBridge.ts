import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  SessionStatsPayload,
  StreamDeltaPayload,
  StreamDonePayload,
  StreamErrorPayload,
  StreamStartPayload,
} from "./ipc";
import { ipc } from "./ipc";
import { useMessagesStore } from "../state/messagesStore";
import { useWorkspaceStore } from "../state/workspaceStore";

// Default titles assigned at session creation. If a session still has one of
// these after the first assistant response completes, the auto-titling pass
// kicks in. After auto-titling sets something meaningful, the title stays
// stable across subsequent turns (we only re-title from a default).
const DEFAULT_TITLES = new Set(["untitled session", "fork"]);

/**
 * Subscribe to backend stream:* events and route them into the messages store.
 * Returns an unsubscribe function. Call once at app start.
 */
export async function subscribeStreamEvents(): Promise<UnlistenFn> {
  const { addMessage, appendDelta, finishStream, failStream } =
    useMessagesStore.getState();

  const unsubs: UnlistenFn[] = [];

  unsubs.push(
    await listen<StreamStartPayload>("stream:start", (e) => {
      addMessage(e.payload.userMessage);
      addMessage(e.payload.assistantMessage);
    }),
  );

  unsubs.push(
    await listen<StreamDeltaPayload>("stream:delta", (e) => {
      appendDelta(e.payload.assistantMessageId, e.payload.delta);
    }),
  );

  unsubs.push(
    await listen<StreamDonePayload>("stream:done", (e) => {
      finishStream(e.payload.assistantMessageId, e.payload.content);
      maybeAutoTitle(e.payload.sessionId);
    }),
  );

  unsubs.push(
    await listen<StreamErrorPayload>("stream:error", (e) => {
      // Log every upstream failure to the console so a silent empty bubble
      // doesn't hide the real cause (model not found, 401, rate limit, etc.).
      // The error also lands on the assistant message via failStream, but
      // a console line makes it dramatically easier to debug live.
      console.error(
        "[stream:error]",
        e.payload.sessionId,
        e.payload.assistantMessageId,
        e.payload.error,
      );
      failStream(
        e.payload.assistantMessageId,
        e.payload.sessionId,
        e.payload.error,
      );
    }),
  );

  unsubs.push(
    await listen<SessionStatsPayload>("session:stats", (e) => {
      useWorkspaceStore.getState().applySessionStats(
        e.payload.sessionId,
        e.payload.inputTokensTotal,
        e.payload.outputTokensTotal,
        e.payload.lastActivityAt,
      );
    }),
  );

  return () => unsubs.forEach((u) => u());
}

/**
 * Fire-and-forget: if the session still has a default placeholder title,
 * kick off a cheap Haiku call to summarize the exchange into 4 words.
 */
function maybeAutoTitle(sessionId: string) {
  const session = useWorkspaceStore.getState().sessions[sessionId];
  if (!session) return;
  if (!DEFAULT_TITLES.has(session.title.toLowerCase())) return;

  ipc
    .autoTitle(sessionId)
    .then((title) => {
      if (title && title !== session.title) {
        useWorkspaceStore.getState().applyTitleFromBackend(sessionId, title);
      }
    })
    .catch((err) => {
      // Titling is best-effort. A failure here shouldn't surface to the user;
      // they can rename manually later. Just log for debugging.
      console.warn("auto-title failed", err);
    });
}
