import { ArrowUp, GitFork, Loader2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProviderPicker } from "../chrome/ProviderPicker";
import { ipc } from "../lib/ipc";
import { useAppearance } from "../state/appearanceContext";
import { useMessagesStore } from "../state/messagesStore";
import { useWorkspaceStore } from "../state/workspaceStore";

interface ComposerProps {
  sessionId: string;
}

export function Composer({ sessionId }: ComposerProps) {
  const appearance = useAppearance();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const forkSession = useWorkspaceStore((s) => s.forkSession);
  const fanOutAcrossProviders = useWorkspaceStore(
    (s) => s.fanOutAcrossProviders,
  );

  // True if any message in this session is currently streaming.
  const isStreaming = useMessagesStore((s) => {
    const ids = s.bySession[sessionId] ?? [];
    return ids.some((id) => !!s.streaming[id]);
  });

  // Id of the last message in the session — that's the default fork point
  // for the prominent fork button in the composer footer. We select just the
  // id (a primitive) so this doesn't churn during streaming.
  const lastMessageId = useMessagesStore((s) => {
    const ids = s.bySession[sessionId];
    return ids && ids.length > 0 ? ids[ids.length - 1] : null;
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

  const stop = () => {
    ipc
      .stopStream(sessionId)
      .catch((err) => console.error("stop stream failed", err));
  };

  const isTerminal = appearance === "terminal";

  return (
    <div
      className="nodrag nowheel shrink-0 border-t border-(--glass-border) p-3"
      style={{ background: "var(--glass-bg)" }}
    >
      {/* Apple HIG-style input: liquid glass surface with a subtle inset
          highlight and a 4px accent halo on focus. The TERMINAL accents
          (mono font, `›` prefix, blinking caret) live inside this glass
          shell so power users still get the Claude-Code feel while the
          chrome around the cell stays consistent with the rest of the
          app. */}
      <div
        className="group/composer flex items-start gap-2 rounded-2xl border border-(--glass-border-strong) px-3 py-2 shadow-[inset_0_1px_0_0_var(--glass-highlight)] transition-all focus-within:border-accent-from focus-within:shadow-[inset_0_1px_0_0_var(--glass-highlight),0_0_0_4px_color-mix(in_srgb,var(--color-accent-from)_22%,transparent)]"
        style={{
          background: "var(--glass-bg-strong)",
          backdropFilter: "blur(16px) saturate(140%)",
          WebkitBackdropFilter: "blur(16px) saturate(140%)",
        }}
      >
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
            // Skip the Enter that commits an IME composition (CJK, dead-key
            // accents) — isComposing stays true until the candidate is locked in.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={isStreaming ? "streaming…" : isTerminal ? "type a message…" : "Message…"}
          disabled={disabled}
          style={{ fontSize: "var(--chat-text-size)" }}
          className={`chat-scroll flex-1 resize-none bg-transparent leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:opacity-50 ${
            isTerminal ? "font-mono" : "font-sans"
          }`}
        />
        {isStreaming ? (
          <button
            onClick={stop}
            aria-label="Stop generating"
            title="Stop generating"
            className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-all hover:bg-danger/15 hover:text-danger"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <button
            onClick={send}
            aria-label="Send"
            disabled={!value.trim() || busy}
            className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-all hover:bg-accent-from/15 hover:text-accent-from disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        {error ? (
          <div className="font-mono text-[10px] text-danger">⚠ {error}</div>
        ) : (
          <div className="flex items-center gap-1.5 font-mono text-[9px] text-fg-subtle">
            <kbd className="rounded border border-border bg-bg-elevated px-1 text-fg-muted">
              ↵
            </kbd>
            <span>send</span>
            <span className="text-fg-subtle/50">·</span>
            <kbd className="rounded border border-border bg-bg-elevated px-1 text-fg-muted">
              ⇧↵
            </kbd>
            <span>newline</span>
          </div>
        )}

        {/* Prominent always-visible fork button. Opens the cross-LLM picker
            (Claude / GPT / Gemini / Ollama) and forks from the LAST message
            in the session. To fork from an earlier point, the user scrolls
            up and clicks the per-message fork affordance there. */}
        {lastMessageId && !isStreaming && (
          <ProviderPicker
            title="fork conversation into…"
            onPick={(p) => {
              forkSession(sessionId, lastMessageId, undefined, {
                providerId: p.providerId,
                modelId: p.modelId,
                transportId: p.transportId,
              }).catch((err) => console.error("fork from composer failed", err));
            }}
            onPickAll={(providers) => {
              fanOutAcrossProviders(
                sessionId,
                lastMessageId,
                providers.map((p) => ({
                  providerId: p.providerId,
                  modelId: p.modelId,
                  transportId: p.transportId,
                })),
              ).catch((err) =>
                console.error("composer cross-provider fan-out failed", err),
              );
            }}
            trigger={
              <button
                aria-label="Fork conversation"
                title="Fork from the latest message into another LLM"
                className="group/forkbtn flex h-7 items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-2.5 font-mono text-[10px] text-fg-muted transition-all hover:border-accent-from hover:bg-accent-from/10 hover:text-accent-from"
              >
                <GitFork className="h-3 w-3" />
                fork
                <span className="text-fg-subtle/70 group-hover/forkbtn:text-accent-from/70">
                  ⇢
                </span>
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
