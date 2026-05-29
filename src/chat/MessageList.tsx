import { useEffect, useLayoutEffect, useRef } from "react";
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

  // Smart wheel routing for permissive canvas navigation. We attach a
  // *native* listener (with capture) instead of using React's onWheel
  // because xyflow attaches its own native wheel listener on the canvas
  // container and React's synthetic stopPropagation does not stop native
  // listeners from firing. Running in capture phase means we always see
  // the event first.
  //
  //   • pinch (ctrl/meta + wheel) → let it bubble so xyflow zooms
  //   • scroll mid-list           → scroll the messages, swallow the event
  //                                 so xyflow doesn't also pan
  //   • scroll past top/bottom    → let it bubble so xyflow pans the canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const hasOverflow = el.scrollHeight > el.clientHeight + 1;
      if (!hasOverflow) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const goingUp = e.deltaY < 0;
      const goingDown = e.deltaY > 0;
      if ((atTop && goingUp) || (atBottom && goingDown)) return;
      // Mid-list — scroll us, block xyflow's native listener entirely.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      el.scrollTop += e.deltaY;
    };
    // capture: true → fires before xyflow's bubble-phase listener
    // passive: false → preventDefault is allowed (xyflow uses preventScrolling)
    el.addEventListener("wheel", handler, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", handler, { capture: true });
  }, []);

  // Render the same container for both populated and empty states so the
  // wheel-listener effect always has a real `containerRef.current` to bind
  // to. Splitting into two return paths caused the bug where freshly-forked
  // GPT sessions (which started with zero messages) never got their wheel
  // listener attached — the populated div was never mounted when the
  // useEffect ran, so the ref was null.
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="chat-scroll nodrag nopan flex flex-1 flex-col space-y-2.5 overflow-y-auto px-3 py-3"
    >
      {ids.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="font-mono text-[11px] text-fg-subtle">
            start the conversation…
          </p>
        </div>
      ) : (
        ids.map((id) => {
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
        })
      )}
    </div>
  );
}
