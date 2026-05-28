import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { useAppearance } from "../state/appearanceContext";
import { useMessagesStore } from "../state/messagesStore";

interface ComposerProps {
  sessionId: string;
}

export function Composer({ sessionId }: ComposerProps) {
  const appearance = useAppearance();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // True if any message in this session is currently streaming.
  const isStreaming = useMessagesStore((s) => {
    const ids = s.bySession[sessionId] ?? [];
    return ids.some((id) => !!s.streaming[id]);
  });

  // Auto-resize textarea up to a cap.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [value]);

  const disabled = busy || isStreaming;

  const send = async () => {
    const text = value.trim();
    if (!text || disabled) return;
    setError(null);
    setBusy(true);
    setValue("");
    try {
      await ipc.startStream(sessionId, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setValue(text); // restore so the user doesn't lose their input
    } finally {
      setBusy(false);
    }
  };

  const isTerminal = appearance === "terminal";

  return (
    <div className="nodrag nowheel border-t border-border bg-bg-elevated/60 p-2">
      <div className="group/composer flex items-start gap-2 rounded-md border border-border bg-bg px-2 py-1.5 transition-colors focus-within:border-accent-from/60">
        {isTerminal && (
          <span
            aria-hidden
            className="mt-px select-none font-mono leading-relaxed text-fg-subtle group-focus-within/composer:text-accent-from"
            style={{ fontSize: "var(--chat-text-size)" }}
          >
            ›
          </span>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Don't let xyflow eat the keystroke
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={isStreaming ? "streaming…" : isTerminal ? "type a message…" : "Message…"}
          disabled={disabled}
          style={{ fontSize: "var(--chat-text-size)" }}
          className={`flex-1 resize-none bg-transparent leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50 ${
            isTerminal ? "font-mono" : "font-sans"
          }`}
        />
        <button
          onClick={send}
          aria-label="Send"
          disabled={!value.trim() || disabled}
          className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy || isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between px-1">
        {error ? (
          <div className="font-mono text-[10px] text-danger">⚠ {error}</div>
        ) : (
          <div className="font-mono text-[9px] text-fg-subtle/70">
            <kbd className="rounded border border-border bg-bg px-1 text-fg-muted">↵</kbd> send ·{" "}
            <kbd className="rounded border border-border bg-bg px-1 text-fg-muted">⇧↵</kbd> newline
          </div>
        )}
      </div>
    </div>
  );
}
