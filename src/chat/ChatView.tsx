import { useEffect } from "react";
import { useMessagesStore } from "../state/messagesStore";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatViewProps {
  sessionId: string;
}

export function ChatView({ sessionId }: ChatViewProps) {
  const hydrate = useMessagesStore((s) => s.hydrateForSession);
  const hydrated = useMessagesStore((s) => !!s.hydratedSessions[sessionId]);

  useEffect(() => {
    if (!hydrated) {
      hydrate(sessionId).catch((err) => {
        console.error("hydrate messages failed", err);
      });
    }
  }, [hydrated, hydrate, sessionId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageList sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </div>
  );
}
