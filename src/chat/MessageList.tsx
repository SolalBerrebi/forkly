import { useLayoutEffect, useRef } from "react";
import { useMessagesStore } from "../state/messagesStore";
import { Message } from "./Message";

interface MessageListProps {
  sessionId: string;
}

// Stable empty-array reference so the selector doesn't churn React when a
// session has no messages yet. Returning a fresh `[]` from a Zustand selector
// breaks getSnapshot caching → 'Maximum update depth exceeded' → renderer dies.
const EMPTY_IDS: string[] = [];

export function MessageList({ sessionId }: MessageListProps) {
  const ids = useMessagesStore((s) => s.bySession[sessionId] ?? EMPTY_IDS);
  const byId = useMessagesStore((s) => s.byId);
  const streaming = useMessagesStore((s) => s.streaming);
  const errors = useMessagesStore((s) => s.errors);

  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Maintain a "stick to bottom" mode unless the user scrolls up.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 60;
  };

  if (ids.length === 0) {
    return (
      <div className="nodrag flex flex-1 items-center justify-center px-4">
        <p className="font-mono text-[11px] text-fg-subtle">
          start the conversation…
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="nodrag nowheel nopan flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
    >
      {ids.map((id) => {
        const m = byId[id];
        if (!m) return null;
        return (
          <Message
            key={m.id}
            message={m}
            isStreaming={!!streaming[m.id]}
            error={errors[m.id]}
          />
        );
      })}
    </div>
  );
}
