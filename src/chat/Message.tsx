import { GitFork } from "lucide-react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as MessageT } from "../lib/ipc";
import { useWorkspaceStore } from "../state/workspaceStore";

interface MessageProps {
  message: MessageT;
  isStreaming?: boolean;
  error?: string;
}

const MARKDOWN_PLUGINS = [remarkGfm];

function MessageImpl({ message, isStreaming, error }: MessageProps) {
  const forkSession = useWorkspaceStore((s) => s.forkSession);
  const isUser = message.role === "user";
  const label = isUser ? "you" : message.modelId ?? "assistant";
  const content = message.content || (isStreaming && !isUser ? "…" : "");

  const handleFork = () => {
    forkSession(message.sessionId, message.id).catch((err) => {
      console.error("fork failed", err);
    });
  };

  return (
    <div className="group/msg relative space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
          {label}
        </div>
        {!isStreaming && (
          <button
            onClick={handleFork}
            aria-label="Fork from here"
            title="Fork from here"
            className="flex h-5 items-center gap-1 rounded border border-border bg-bg-elevated px-1.5 font-mono text-[9px] text-fg-subtle opacity-0 transition-all group-hover/msg:opacity-100 hover:border-accent-from hover:text-accent-from"
          >
            <GitFork className="h-2.5 w-2.5" />
            fork
          </button>
        )}
      </div>

      <div className={isUser ? "font-mono text-[12px] leading-relaxed text-fg" : "chat-md font-sans text-[12.5px] text-fg"}>
        {isUser ? (
          <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
        ) : (
          <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{content}</ReactMarkdown>
        )}
      </div>

      {isStreaming && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-fg-subtle">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-from" />
          streaming
        </div>
      )}
      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[10px] text-danger">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

export const Message = memo(MessageImpl);
