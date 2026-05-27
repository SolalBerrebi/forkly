import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { useMessagesStore } from "../state/messagesStore";

interface ComposerProps {
  sessionId: string;
}

export function Composer({ sessionId }: ComposerProps) {
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

  return (
    <div className="nodrag nowheel border-t border-border bg-bg-elevated/60 p-2">
      <div className="flex items-end gap-2 rounded-md border border-border bg-bg px-2 py-1.5 focus-within:border-border-strong">
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
          placeholder={isStreaming ? "streaming…" : "type a message…"}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent font-mono text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50"
        />
        <button
          onClick={send}
          aria-label="Send"
          disabled={!value.trim() || disabled}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy || isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {error && (
        <div className="mt-1.5 px-1 font-mono text-[10px] text-danger">⚠ {error}</div>
      )}
    </div>
  );
}
