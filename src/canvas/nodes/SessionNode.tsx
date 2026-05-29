import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Handle,
  NodeResizer,
  Position,
  useStore,
  type Node,
  type NodeProps,
  type ReactFlowState,
} from "@xyflow/react";
import { motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  GitBranch,
  GitFork,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  Terminal,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { ChatView } from "../../chat/ChatView";
import { ConfirmDialog } from "../../chrome/ConfirmDialog";
import { formatCompactCount, formatRelativeTime } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { MODEL_CATALOG, labelForModel } from "../../providers/models";
import { providerTheme } from "../../providers/theme";
import { useMessagesStore } from "../../state/messagesStore";
import { SessionAppearanceProvider, useAppearance } from "../../state/appearanceContext";
import { useDetectionStore } from "../../state/detectionStore";
import { useWorkspaceStore } from "../../state/workspaceStore";

export interface SessionNodeData extends Record<string, unknown> {
  title: string;
  providerId: string;
  modelId: string;
}

export type SessionNodeType = Node<SessionNodeData, "session">;

// Subscribe only to the zoom scalar — the rest of viewport state can change
// many times per second during pan, and we don't want to re-render every node
// on pan ticks.
const zoomSelector = (s: ReactFlowState) => s.transform[2];

// Two zoom modes, not three. Under the threshold the cell collapses to its
// label so a big branching workspace stays legible; above it the cell keeps
// rendering the full scrollable conversation. The earlier "compact" middle
// stage (just the last user + assistant snippet) made it impossible to keep
// reading the whole thread while zooming out a bit, so it's gone.
const FULL_MIN_ZOOM = 0.32;

// Default cell footprint — terminal ratio (≈ 80×24 columns in pixels). People
// see chat-with-LLM as a terminal session, so the canvas-default mirrors that
// shape. Users can resize freely (and switch to chat-style via Settings).
const DEFAULT_WIDTH = 560;
const DEFAULT_HEIGHT = 400;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 220;
// "Effectively unlimited" — large enough that no monitor will hit the cap,
// while still keeping a sanity bound so a stray drag can't break the canvas.
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;

function SessionNodeImpl({ id, data, selected }: NodeProps<SessionNodeType>) {
  const zoom = useStore(zoomSelector);
  const removeSession = useWorkspaceStore((s) => s.removeSession);
  const updateSessionSize = useWorkspaceStore((s) => s.updateSessionSize);
  const toggleSessionExpanded = useWorkspaceStore((s) => s.toggleSessionExpanded);
  const updateSessionAppearance = useWorkspaceStore((s) => s.updateSessionAppearance);
  const width = useWorkspaceStore((s) => s.sessions[id]?.width ?? null);
  const height = useWorkspaceStore((s) => s.sessions[id]?.height ?? null);
  const appearanceOverride = useWorkspaceStore(
    (s) => s.sessions[id]?.appearanceOverride ?? null,
  );
  const globalAppearance = useAppearance();
  const effectiveAppearance = appearanceOverride ?? globalAppearance;
  const isExpanded = useWorkspaceStore((s) => {
    const sess = s.sessions[id];
    return !!(sess?.preExpandWidth !== null && sess?.preExpandWidth !== undefined);
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggleAppearance = () => {
    const next = effectiveAppearance === "terminal" ? "chat" : "terminal";
    updateSessionAppearance(id, next).catch((err) =>
      console.error("update appearance failed", err),
    );
  };

  const mode: "full" | "label" = zoom >= FULL_MIN_ZOOM ? "full" : "label";

  const effectiveWidth = width ?? DEFAULT_WIDTH;
  const effectiveHeight = height ?? DEFAULT_HEIGHT;

  const handleDelete = async () => {
    try {
      await removeSession(id);
    } catch (err) {
      console.error("delete session failed", err);
    }
  };

  const handleToggleExpand = () => {
    toggleSessionExpanded(id).catch((err) =>
      console.error("toggle expand failed", err),
    );
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{
          width: effectiveWidth,
          height: effectiveHeight,
          background: "var(--glass-bg-strong)",
        }}
        className={[
          // Liquid glass card. The surface uses a translucent fill + 22px
          // backdrop blur so the aurora background actually bleeds through;
          // the inset highlight on top is what gives the "glass edge" look
          // Apple uses on every visionOS panel. Selected state replaces the
          // border color and stacks an outer accent halo — no ring (rings
          // draw outside our rounded corner and look broken).
          "group relative flex flex-col overflow-hidden rounded-[20px] border",
          "backdrop-blur-xl backdrop-saturate-140",
          "shadow-[inset_0_1px_0_0_var(--glass-highlight),0_30px_80px_-32px_rgba(0,0,0,0.6),0_4px_16px_-6px_rgba(0,0,0,0.3)]",
          "transition-[border-color,box-shadow,transform] duration-200",
          selected
            ? "border-accent-from shadow-[inset_0_1px_0_0_var(--glass-highlight),0_0_0_3px_color-mix(in_srgb,var(--color-accent-from)_22%,transparent),0_0_80px_-10px_color-mix(in_srgb,var(--color-accent-from)_55%,transparent),0_30px_80px_-32px_rgba(0,0,0,0.6)]"
            : "border-(--glass-border) hover:border-(--glass-border-strong) hover:-translate-y-px",
        ].join(" ")}
      >
        {/* Always-mounted (unless expanded) so the resize cursor shows the
            instant you hover an edge — no click-to-select required. Visual
            chrome (handle squares + accent border) is faded in via the
            .react-flow__resize-control rules in globals.css when the node
            is hovered or selected. */}
        <NodeResizer
          isVisible={!isExpanded}
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          maxWidth={MAX_WIDTH}
          maxHeight={MAX_HEIGHT}
          lineStyle={{ borderColor: "var(--color-accent-from)", borderWidth: 1 }}
          handleStyle={{
            background: "var(--color-accent-from)",
            border: "1px solid var(--color-bg-elevated)",
            width: 8,
            height: 8,
            borderRadius: 2,
          }}
          onResize={(_event, params) => {
            updateSessionSize(id, params.width, params.height);
          }}
        />
        {/* Handles must remain mounted so xyflow has anchor points for edges,
            but we hide them completely — Forkly never asks the user to draw a
            connection by hand (lineage is created via fork/fan-out actions),
            so the dots are pure visual noise. */}
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="pointer-events-none! h-px! w-px! min-h-0! min-w-0! border-0! bg-transparent! opacity-0!"
        />
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="pointer-events-none! h-px! w-px! min-h-0! min-w-0! border-0! bg-transparent! opacity-0!"
        />

        {/* Header — same across all modes; thin identification strip with a
            hover-revealed "..." menu for per-node actions (delete, etc.).
            Icon pill is tinted by the active provider's brand color so the
            user can tell at a glance which model this cell is wired to. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{
              background: providerTheme(data.providerId).tint,
              color: providerTheme(data.providerId).fg,
            }}
            title={providerTheme(data.providerId).label}
          >
            <GitFork className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 truncate font-mono text-xs text-fg">{data.title}</div>
          <ModelPicker
            sessionId={id}
            providerId={data.providerId}
            modelId={data.modelId}
          />
          <button
            onClick={toggleAppearance}
            aria-label={
              effectiveAppearance === "terminal"
                ? "Switch this cell to chat appearance"
                : "Switch this cell to terminal appearance"
            }
            title={
              appearanceOverride
                ? `appearance: ${effectiveAppearance} (per-cell override)`
                : `appearance: ${effectiveAppearance} (follows global)`
            }
            className={[
              "flex h-5 w-5 items-center justify-center rounded transition-all hover:bg-bg hover:text-fg",
              // Highlight only when this cell is overriding the global — gives
              // an at-a-glance signal that this cell is doing its own thing.
              appearanceOverride
                ? "text-accent-from"
                : "text-fg-subtle opacity-0 group-hover:opacity-100",
            ].join(" ")}
          >
            {effectiveAppearance === "terminal" ? (
              <Terminal className="h-3 w-3" />
            ) : (
              <MessageSquare className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={handleToggleExpand}
            aria-label={isExpanded ? "Collapse session" : "Expand session"}
            title={isExpanded ? "Collapse · restore previous size" : "Expand"}
            className={[
              "flex h-5 w-5 items-center justify-center rounded transition-all hover:bg-bg hover:text-fg",
              // Always-visible when expanded so the user has an obvious way
              // back; hover-revealed otherwise to keep the header clean.
              isExpanded
                ? "text-accent-from"
                : "text-fg-subtle opacity-0 group-hover:opacity-100",
            ].join(" ")}
          >
            {isExpanded ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label="Session actions"
                className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle opacity-0 transition-all group-hover:opacity-100 hover:bg-bg hover:text-fg"
              >
                <MoreHorizontal className="h-3 w-3" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-44 overflow-hidden rounded-md border border-border bg-bg-elevated p-1 shadow-xl"
              >
                {appearanceOverride !== null && (
                  <>
                    <DropdownMenu.Item
                      onSelect={() => {
                        updateSessionAppearance(id, null).catch((err) =>
                          console.error("clear appearance failed", err),
                        );
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 font-mono text-[11px] text-fg-muted outline-none data-highlighted:bg-bg data-highlighted:text-fg"
                    >
                      <Check className="h-3 w-3 text-accent-from" />
                      follow global appearance
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  </>
                )}
                <DropdownMenu.Item
                  onSelect={() => setConfirmOpen(true)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 font-mono text-[11px] text-danger outline-none data-highlighted:bg-danger/10"
                >
                  <Trash2 className="h-3 w-3" />
                  delete session
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        {/* Info chips strip — only renders in full mode to avoid cluttering
            compact / label views. Reads stats from the workspaceStore so it
            updates after every stream:done via the session:stats event. */}
        {mode === "full" && <SessionInfoChips sessionId={id} />}

        {/* Wrap the body in a per-session appearance provider so the chat /
            terminal toggle in the header only affects THIS cell — Composer,
            Message, and CSS-selector children all reroute through it. */}
        <SessionAppearanceProvider override={appearanceOverride}>
          {mode === "full" && <ChatView sessionId={id} />}
          {mode === "label" && <LabelBody data={data} />}
        </SessionAppearanceProvider>
      </motion.div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`delete "${data.title}"?`}
        description={
          <>
            This permanently removes the session and all its messages. Forks
            from it stay on the canvas but no longer share lineage.
          </>
        }
        confirmLabel="delete"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}

/**
 * Custom equality: SessionNode re-renders only when something that actually
 * affects its rendered output changes. Pan and zoom of the canvas re-pass
 * the SAME data + selected to every node — without memo, every node would
 * re-evaluate on every viewport tick and trackpad pan would feel stuttery.
 * Internal subscriptions (workspaceStore, messagesStore) still trigger
 * re-renders when their slices change; this just skips the no-op churn.
 */
export const SessionNode = memo(SessionNodeImpl, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.selected === next.selected &&
    prev.data.title === next.data.title &&
    prev.data.providerId === next.data.providerId &&
    prev.data.modelId === next.data.modelId
  );
});

/** Default transport for a provider, honouring CLI subscription auth when
 *  detected at app boot. We bias toward the user's existing subscription
 *  (free for them) over a paid API key call. */
function defaultTransportFor(
  providerId: string,
  detection: ReturnType<typeof useDetectionStore.getState>,
): "api" | "claude-code" | "codex" | "ollama" {
  if (providerId === "anthropic") {
    return detection.claudeCode?.loggedIn ? "claude-code" : "api";
  }
  if (providerId === "openai") {
    return detection.codex?.loggedIn ? "codex" : "api";
  }
  if (providerId === "ollama") {
    return "ollama";
  }
  return "api";
}

function ModelPicker({
  sessionId,
  providerId,
  modelId,
}: {
  sessionId: string;
  providerId: string;
  modelId: string;
}) {
  const updateSessionModel = useWorkspaceStore((s) => s.updateSessionModel);
  const updateSessionProviderModel = useWorkspaceStore(
    (s) => s.updateSessionProviderModel,
  );
  const isStreaming = useMessagesStore((s) => !!s.streamingSessions[sessionId]);
  // Ollama models are dynamic: they come from whatever the user has pulled
  // via `ollama pull` on their machine. We only show the Ollama section if
  // the daemon is running AND has at least one model installed.
  const ollamaModels = useDetectionStore((s) =>
    s.ollama?.running ? s.ollama.models : null,
  );
  const currentLabel =
    providerId === "ollama"
      ? // Ollama IDs are user-friendly already (e.g. "llama3.2:latest")
        modelId.replace(":latest", "")
      : labelForModel(providerId, modelId);
  const theme = providerTheme(providerId);
  // All providers known to the picker. Static catalog + dynamic Ollama
  // section when available. Ordered so the current provider sits first
  // (it's what the user expects to scan) and the rest follow alphabetically.
  const providerIds = (() => {
    const ids = new Set(Object.keys(MODEL_CATALOG));
    if (ollamaModels && ollamaModels.length > 0) ids.add("ollama");
    return Array.from(ids).sort((a, b) => {
      if (a === providerId) return -1;
      if (b === providerId) return 1;
      return a.localeCompare(b);
    });
  })();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Switch model"
          className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-tight transition-colors hover:brightness-110"
          style={{ background: theme.tint, color: theme.fg }}
        >
          <StatusDot active={isStreaming} color={theme.fg} />
          {currentLabel}
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-52 overflow-hidden rounded-md border border-border bg-bg-elevated p-1 shadow-xl"
        >
          {providerIds.map((pid, idx) => {
            const pTheme = providerTheme(pid);
            // Static catalog providers come from MODEL_CATALOG. Ollama is
            // dynamic — generated from whatever the user has pulled.
            const options =
              pid === "ollama" && ollamaModels
                ? ollamaModels.map((m) => ({
                    id: m.id,
                    label: m.id.replace(":latest", ""),
                    description:
                      m.sizeBytes !== null
                        ? `${(m.sizeBytes / 1e9).toFixed(1)}GB`
                        : undefined,
                  }))
                : MODEL_CATALOG[pid] ?? [];
            return (
              <div key={pid}>
                {idx > 0 && <div className="my-1 h-px bg-border" />}
                <div
                  className="flex items-center gap-1.5 px-2 py-1 font-mono text-[9px] uppercase tracking-wider"
                  style={{ color: pTheme.fg }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: pTheme.fg }}
                    aria-hidden
                  />
                  {pTheme.label}
                </div>
                {options.map((opt) => {
                  const active = pid === providerId && opt.id === modelId;
                  const samePid = pid === providerId;
                  return (
                    <DropdownMenu.Item
                      key={`${pid}:${opt.id}`}
                      onSelect={() => {
                        if (active) return;
                        if (samePid) {
                          updateSessionModel(sessionId, opt.id).catch((err) =>
                            console.error("update model failed", err),
                          );
                        } else {
                          // Pick the cheapest available transport for the
                          // new provider: prefer subscription CLI if logged
                          // in, fall back to HTTP API. Read detection at
                          // click time so a `codex login` since last boot
                          // is honoured without a relaunch.
                          const transport = defaultTransportFor(
                            pid,
                            useDetectionStore.getState(),
                          );
                          updateSessionProviderModel(
                            sessionId,
                            pid,
                            opt.id,
                            transport,
                          ).catch((err) =>
                            console.error("switch provider failed", err),
                          );
                        }
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 font-mono text-[11px] text-fg-muted outline-none data-highlighted:bg-bg data-highlighted:text-fg"
                    >
                      <Check
                        className={`h-3 w-3 shrink-0 ${active ? "text-accent-from" : "opacity-0"}`}
                      />
                      <span className="flex-1">{opt.label}</span>
                      {opt.description && (
                        <span className="text-[9px] text-fg-subtle">
                          {opt.description}
                        </span>
                      )}
                    </DropdownMenu.Item>
                  );
                })}
              </div>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SessionInfoChips({ sessionId }: { sessionId: string }) {
  // Each selector returns a primitive (or a value that only changes on
  // stream:done) so this strip never re-renders during streaming.
  const inputTokens = useWorkspaceStore((s) => s.sessions[sessionId]?.inputTokensTotal ?? 0);
  const outputTokens = useWorkspaceStore((s) => s.sessions[sessionId]?.outputTokensTotal ?? 0);
  const lastActivityAt = useWorkspaceStore((s) => s.sessions[sessionId]?.lastActivityAt ?? null);
  const workingDir = useWorkspaceStore((s) => s.sessions[sessionId]?.workingDir ?? null);
  const turnCount = useMessagesStore((s) => (s.bySession[sessionId]?.length ?? 0));

  const [gitBranch, setGitBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!workingDir) {
      setGitBranch(null);
      return;
    }
    let cancelled = false;
    ipc
      .gitBranchFor(workingDir)
      .then((b) => {
        if (!cancelled) setGitBranch(b);
      })
      .catch(() => {
        if (!cancelled) setGitBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workingDir]);

  const hasTokens = inputTokens > 0 || outputTokens > 0;
  const chips: ReactNode[] = [];
  if (hasTokens) {
    chips.push(
      <span key="tokens" className="flex items-center gap-1 whitespace-nowrap">
        <ChipLabel>tokens</ChipLabel>
        <span className="text-fg-muted">{formatCompactCount(inputTokens)}</span>
        <span className="text-fg-subtle/60">›</span>
        <span className="text-fg-muted">{formatCompactCount(outputTokens)}</span>
      </span>,
    );
  }
  if (turnCount > 0) {
    chips.push(
      <span key="turns" className="flex items-center gap-1 whitespace-nowrap">
        <ChipLabel>turns</ChipLabel>
        <span className="text-fg-muted">{turnCount}</span>
      </span>,
    );
  }
  if (lastActivityAt) {
    chips.push(
      <span key="last" className="flex items-center gap-1 whitespace-nowrap">
        <ChipLabel>last</ChipLabel>
        <span className="text-fg-muted">{formatRelativeTime(lastActivityAt)}</span>
      </span>,
    );
  }
  if (gitBranch) {
    chips.push(
      <span key="branch" className="flex items-center gap-1 whitespace-nowrap">
        <GitBranch className="h-2.5 w-2.5 text-fg-subtle/70" />
        <span className="truncate text-fg-muted">{gitBranch}</span>
      </span>,
    );
  }

  if (chips.length === 0) return null;

  // Render chips with subtle `·` separators for visual rhythm.
  const withSeparators: ReactNode[] = [];
  chips.forEach((chip, i) => {
    if (i > 0) {
      withSeparators.push(
        <span key={`sep-${i}`} className="text-fg-subtle/30">·</span>,
      );
    }
    withSeparators.push(chip);
  });

  return (
    <div className="chat-scroll flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border/60 bg-bg/40 px-3 py-1.5 font-mono text-[9px] text-fg-subtle">
      {withSeparators}
    </div>
  );
}

function ChipLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="uppercase tracking-wider text-fg-subtle/70">{children}</span>
  );
}

/**
 * Small state dot next to the model chip. Solid muted when idle; pulses
 * accent-violet while the session has a streaming assistant message.
 */
function StatusDot({ active, color }: { active: boolean; color?: string }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${active ? "animate-pulse" : ""}`}
      style={{
        background: active ? color ?? "var(--color-accent-from)" : "color-mix(in srgb, var(--color-fg-subtle) 60%, transparent)",
      }}
      aria-hidden
    />
  );
}

function LabelBody({ data }: { data: SessionNodeData }) {
  // At very far zoom the actual on-screen height is ~50-100px; even a single
  // big line of text becomes unreadable. We render the title huge so the
  // workspace stays scannable even when fully zoomed out.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="font-mono text-[44px] leading-none tracking-tight text-fg">
        {data.title}
      </div>
      <div className="font-mono text-[18px] text-fg-muted">{data.modelId}</div>
    </div>
  );
}
