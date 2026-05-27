import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as MessageT } from "../lib/ipc";

interface MessageProps {
  message: MessageT;
  isStreaming?: boolean;
  error?: string;
}

const MARKDOWN_PLUGINS = [remarkGfm];

function MessageImpl({ message, isStreaming, error }: MessageProps) {
  const isUser = message.role === "user";
  const label = isUser ? "you" : message.modelId ?? "assistant";

  // Show a caret while a streaming assistant message is still empty
  const content = message.content || (isStreaming && !isUser ? "…" : "");

  return (
    <div className="space-y-1">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      <div className={isUser ? "font-mono text-[12px] leading-relaxed text-fg" : "chat-md font-sans text-[12.5px] text-fg"}>
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
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
