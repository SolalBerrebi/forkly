import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  StreamDeltaPayload,
  StreamDonePayload,
  StreamErrorPayload,
  StreamStartPayload,
} from "./ipc";
import { useMessagesStore } from "../state/messagesStore";

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
    }),
  );

  unsubs.push(
    await listen<StreamErrorPayload>("stream:error", (e) => {
      failStream(
        e.payload.assistantMessageId,
        e.payload.sessionId,
        e.payload.error,
      );
    }),
  );

  return () => unsubs.forEach((u) => u());
}
