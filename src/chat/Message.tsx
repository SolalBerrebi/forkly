import { GitFork } from "lucide-react";
import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderPicker } from "../chrome/ProviderPicker";
import { getAvailableProviders } from "../lib/availableProviders";
import type { Message as MessageT } from "../lib/ipc";
import { useAppearance } from "../state/appearanceContext";
import { useDetectionStore } from "../state/detectionStore";
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
  const fanOutAcrossProviders = useWorkspaceStore(
    (s) => s.fanOutAcrossProviders,
  );
  const [hovered, setHovered] = useState(false);

  const isUser = message.role === "user";
  const label = isUser ? "you" : message.modelId ?? "assistant";
  const content = message.content;
  const showStreamingIndicator = isStreaming && !isUser;

  const handleFork = (override?: {
    providerId: string;
    modelId: string;
    transportId: import("../lib/ipc").TransportId;
  }) => {
    forkSession(message.sessionId, message.id, undefined, override).catch(
      (err) => {
        console.error("fork failed", err);
      },
    );
  };

  const handleFanOutAll = (
    providers: ReadonlyArray<{
      providerId: string;
      modelId: string;
      transportId: import("../lib/ipc").TransportId;
    }>,
  ) => {
    fanOutAcrossProviders(message.sessionId, message.id, providers).catch(
      (err) => console.error("cross-provider fan-out failed", err),
    );
  };

  // While hovering a message:
  //   • 2–9  → spawns N same-provider sibling forks (existing).
  //   • A    → fan out to every available provider in one shot. The killer
  //            cross-LLM demo, accessible to power users via keyboard.
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
      // Cross-provider fan-out shortcut.
      if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        // Pull the latest provider list at fire time (not from a stale
        // closure) so a `codex login` since hover is honoured.
        const detection = useDetectionStore.getState();
        const providers = getAvailableProviders({
          claudeCode: detection.claudeCode,
          codex: detection.codex,
          ollama: detection.ollama,
          apiKeys: detection.apiKeys,
        });
        if (providers.length < 2) return;
        handleFanOutAll(providers);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          onFanOutAll={handleFanOutAll}
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
              {label}
            </div>
            <ForkButton onFork={handleFork} onFanOutAll={handleFanOutAll} hidden={!!isStreaming} />
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
            <ForkButton onFork={handleFork} onFanOutAll={handleFanOutAll} hidden={!!isStreaming} />
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
  onFanOutAll,
}: {
  label: string;
  isStreaming?: boolean;
  onFork: (override?: {
    providerId: string;
    modelId: string;
    transportId: import("../lib/ipc").TransportId;
  }) => void;
  onFanOutAll: (
    providers: ReadonlyArray<{
      providerId: string;
      modelId: string;
      transportId: import("../lib/ipc").TransportId;
    }>,
  ) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
        {label}
      </div>
      {!isStreaming && (
        <ForkButton onFork={onFork} onFanOutAll={onFanOutAll} hidden={false} />
      )}
    </div>
  );
}

/**
 * Always-visible fork button on every message. Clicking it opens a tiny
 * picker listing every configured LLM — Claude, GPT, Gemini, Ollama — so
 * the user can spawn a cross-provider branch in one click. The fan-out
 * shortcut (2–9 on hover) still works for same-provider parallel forks.
 *
 * When only one provider is configured, the picker collapses to a direct
 * action: no menu, just a single click forks.
 */
function ForkButton({
  onFork,
  onFanOutAll,
  hidden,
}: {
  onFork: (override?: {
    providerId: string;
    modelId: string;
    transportId: import("../lib/ipc").TransportId;
  }) => void;
  onFanOutAll?: (
    providers: ReadonlyArray<{
      providerId: string;
      modelId: string;
      transportId: import("../lib/ipc").TransportId;
    }>,
  ) => void;
  hidden: boolean;
}) {
  if (hidden) return null;
  return (
    <ProviderPicker
      title="fork into…"
      onPick={(p) =>
        onFork({
          providerId: p.providerId,
          modelId: p.modelId,
          transportId: p.transportId,
        })
      }
      onPickAll={
        onFanOutAll
          ? (providers) =>
              onFanOutAll(
                providers.map((p) => ({
                  providerId: p.providerId,
                  modelId: p.modelId,
                  transportId: p.transportId,
                })),
              )
          : undefined
      }
      trigger={
        <button
          aria-label="Fork from here"
          title="Fork from here · pick an LLM to continue with · press A to fan out to all"
          className="flex h-5 items-center gap-1 rounded-md border border-border bg-bg-elevated px-1.5 font-mono text-[9px] text-fg-muted transition-colors hover:border-accent-from hover:text-accent-from"
        >
          <GitFork className="h-2.5 w-2.5" />
          fork
        </button>
      }
    />
  );
}

function ErrorRow({ error }: { error: string }) {
  // The whole row opens the in-app network log drawer, where the raw
  // upstream call (Codex CLI command or OpenAI/Anthropic HTTP request) is
  // visible with status code, duration, and detail. Saves the user from
  // hunting for the lightning icon when they just want to know what broke.
  const open = () =>
    window.dispatchEvent(new CustomEvent("forkly:open-network-log"));
  return (
    <button
      onClick={open}
      title="Open the network log to see the raw upstream call"
      className="mt-1.5 flex w-full items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-left font-mono text-[10px] text-danger transition-colors hover:bg-danger/15"
    >
      <span aria-hidden>⚠</span>
      <span className="flex-1">{error}</span>
      <span className="shrink-0 text-[9px] text-danger/70 underline-offset-2 hover:underline">
        open log →
      </span>
    </button>
  );
}

export const Message = memo(MessageImpl);
