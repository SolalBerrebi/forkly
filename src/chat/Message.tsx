import { GitFork } from "lucide-react";
import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as MessageT } from "../lib/ipc";
import { useAppearance } from "../state/appearanceContext";
import { useWorkspaceStore } from "../state/workspaceStore";

interface MessageProps {
  message: MessageT;
  isStreaming?: boolean;
  error?: string;
}

const MARKDOWN_PLUGINS = [remarkGfm];

function MessageImpl({ message, isStreaming, error }: MessageProps) {
  const appearance = useAppearance();
  const forkSession = useWorkspaceStore((s) => s.forkSession);
  const fanOut = useWorkspaceStore((s) => s.fanOut);
  const [hovered, setHovered] = useState(false);

  const isUser = message.role === "user";
  const label = isUser ? "you" : message.modelId ?? "assistant";
  const content = message.content;
  const showStreamingIndicator = isStreaming && !isUser;

  const handleFork = () => {
    forkSession(message.sessionId, message.id).catch((err) => {
      console.error("fork failed", err);
    });
  };

  // While hovering a message, 2-9 spawns N parallel forks with the latest
  // user prompt rebroadcast. Per-message listener so it scopes correctly
  // to whatever the user is pointing at.
  useEffect(() => {
    if (!hovered || isStreaming) return;
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      const n = parseInt(e.key, 10);
      if (Number.isNaN(n) || n < 2 || n > 9) return;
      e.preventDefault();
      e.stopPropagation();
      fanOut(message.sessionId, message.id, n).catch((err) =>
        console.error("fan-out failed", err),
      );
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hovered, isStreaming, message.sessionId, message.id, fanOut]);

  const hoverHandlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  /* ----- TERMINAL APPEARANCE ----- */
  if (appearance === "terminal") {
    return (
      <div className="group/msg relative space-y-1" {...hoverHandlers}>
        <MessageActionsRow
          label={label}
          isStreaming={isStreaming}
          onFork={handleFork}
        />
        <div
          className="chat-md chat-selectable font-mono leading-relaxed text-fg"
          style={{ fontSize: "var(--chat-text-size)" }}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap wrap-break-word">
              <span className="select-none text-fg-subtle">{"› "}</span>
              {message.content}
            </p>
          ) : content ? (
            <>
              <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{content}</ReactMarkdown>
              {showStreamingIndicator && (
                <span className="caret-blink ml-0.5 inline-block text-accent-from" aria-hidden>
                  ▍
                </span>
              )}
            </>
          ) : showStreamingIndicator ? (
            <span className="caret-blink inline-block text-accent-from" aria-hidden>
              ▍
            </span>
          ) : null}
        </div>
        {error && <ErrorRow error={error} />}
      </div>
    );
  }

  /* ----- CHAT APPEARANCE ----- */
  return (
    <div
      className={`group/msg relative ${isUser ? "flex justify-end" : ""}`}
      {...hoverHandlers}
    >
      <div className={isUser ? "max-w-[78%]" : "w-full"}>
        {!isUser && (
          <div className="mb-1 flex items-center justify-between">
            <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
              {label}
            </div>
            <ForkButton onFork={handleFork} hidden={!!isStreaming} />
          </div>
        )}

        {isUser ? (
          <div
            className="chat-bubble-user chat-selectable font-sans leading-relaxed text-fg"
            style={{ fontSize: "var(--chat-text-size)" }}
          >
            <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
          </div>
        ) : (
          <div
            className="chat-md chat-selectable leading-relaxed text-fg"
            style={{ fontSize: "var(--chat-text-size)" }}
          >
            {content ? (
              <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{content}</ReactMarkdown>
            ) : null}
            {showStreamingIndicator && (
              <div className="mt-1 flex items-center gap-1 typing-dots" aria-label="thinking">
                <span /><span /><span />
              </div>
            )}
          </div>
        )}

        {isUser && (
          <div className="mt-0.5 flex justify-end">
            <ForkButton onFork={handleFork} hidden={!!isStreaming} />
          </div>
        )}

        {error && <ErrorRow error={error} />}
      </div>
    </div>
  );
}

function MessageActionsRow({
  label,
  isStreaming,
  onFork,
}: {
  label: string;
  isStreaming?: boolean;
  onFork: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      {!isStreaming && (
        <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover/msg:opacity-100">
          <span className="font-mono text-[9px] text-fg-subtle">
            press <Kbd>2</Kbd>–<Kbd>9</Kbd>
          </span>
          <ForkButton onFork={onFork} hidden={false} />
        </div>
      )}
    </div>
  );
}

function ForkButton({ onFork, hidden }: { onFork: () => void; hidden: boolean }) {
  if (hidden) return null;
  return (
    <button
      onClick={onFork}
      aria-label="Fork from here"
      title="Fork from here"
      className="flex h-5 items-center gap-1 rounded border border-border bg-bg-elevated px-1.5 font-mono text-[9px] text-fg-subtle opacity-0 transition-all group-hover/msg:opacity-100 hover:border-accent-from hover:text-accent-from"
    >
      <GitFork className="h-2.5 w-2.5" />
      fork
    </button>
  );
}

function ErrorRow({ error }: { error: string }) {
  return (
    <div className="mt-1.5 rounded border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[10px] text-danger">
      ⚠ {error}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-bg px-1 text-fg-muted">{children}</kbd>
  );
}

export const Message = memo(MessageImpl);
