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
  Minimize2,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { ChatView } from "../../chat/ChatView";
import { ConfirmDialog } from "../../chrome/ConfirmDialog";
import { formatCompactCount, formatRelativeTime } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { MODEL_CATALOG, labelForModel } from "../../providers/models";
import { useMessagesStore } from "../../state/messagesStore";
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

// Mode thresholds. Picked so the full chat is readable when the node is
// roughly real-size on screen, the compact card stays legible while you're
// "surveying" a small tree, and the minimal label is what you see when you
// zoom out to look at a large branching workspace.
const FULL_MIN_ZOOM = 0.7;
const COMPACT_MIN_ZOOM = 0.35;

// Stable empty-array reference for selectors — otherwise `bySession[sid] ?? []`
// would return a new array every render and break Zustand snapshot caching.
const EMPTY_IDS: string[] = [];

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
  const width = useWorkspaceStore((s) => s.sessions[id]?.width ?? null);
  const height = useWorkspaceStore((s) => s.sessions[id]?.height ?? null);
  const isExpanded = useWorkspaceStore((s) => {
    const sess = s.sessions[id];
    return !!(sess?.preExpandWidth !== null && sess?.preExpandWidth !== undefined);
  });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mode: "full" | "compact" | "label" =
    zoom >= FULL_MIN_ZOOM ? "full" : zoom >= COMPACT_MIN_ZOOM ? "compact" : "label";

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
        style={{ width: effectiveWidth, height: effectiveHeight }}
        className={[
          "group relative flex flex-col overflow-hidden rounded-[12px] border bg-bg-elevated",
          "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] transition-[border-color,box-shadow] duration-200",
          selected
            ? "border-transparent ring-1 ring-accent-from shadow-[0_0_0_1px_var(--color-accent-from),0_0_60px_-8px_color-mix(in_srgb,var(--color-accent-from)_55%,transparent)]"
            : "border-border hover:border-border-strong",
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
        <Handle
          type="target"
          position={Position.Left}
          className="h-2! w-2! border-0! bg-fg-subtle! opacity-0 transition-opacity group-hover:opacity-100"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="h-2! w-2! border-0! bg-fg-subtle! opacity-0 transition-opacity group-hover:opacity-100"
        />

        {/* Header — same across all modes; thin identification strip with a
            hover-revealed "..." menu for per-node actions (delete, etc.). */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-bg text-accent-from">
            <GitFork className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 truncate font-mono text-xs text-fg">{data.title}</div>
          <ModelPicker
            sessionId={id}
            providerId={data.providerId}
            modelId={data.modelId}
          />
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
                className="z-50 min-w-40 overflow-hidden rounded-md border border-border bg-bg-elevated p-1 shadow-xl"
              >
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

        {mode === "full" && <ChatView sessionId={id} />}
        {mode === "compact" && <CompactBody sessionId={id} data={data} />}
        {mode === "label" && <LabelBody data={data} />}
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
  const isStreaming = useMessagesStore((s) => !!s.streamingSessions[sessionId]);
  const options = MODEL_CATALOG[providerId] ?? [];
  const currentLabel = labelForModel(providerId, modelId);

  // If we don't know any models for this provider, render a static read-only
  // chip — matches the old behavior for unknown providers (no dropdown).
  if (options.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-bg px-2 py-0.5 font-mono text-[10px] tracking-tight text-fg-muted">
        <StatusDot active={isStreaming} />
        {providerId}
      </div>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Switch model"
          className="flex items-center gap-1.5 rounded-full bg-bg px-2 py-0.5 font-mono text-[10px] tracking-tight text-fg-muted transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <StatusDot active={isStreaming} />
          {currentLabel}
          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 overflow-hidden rounded-md border border-border bg-bg-elevated p-1 shadow-xl"
        >
          <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
            model
          </div>
          {options.map((opt) => {
            const active = opt.id === modelId;
            return (
              <DropdownMenu.Item
                key={opt.id}
                onSelect={() => {
                  if (active) return;
                  updateSessionModel(sessionId, opt.id).catch((err) =>
                    console.error("update model failed", err),
                  );
                }}
                className="flex items-center gap-2 rounded px-2 py-1.5 font-mono text-[11px] text-fg-muted outline-none data-highlighted:bg-bg data-highlighted:text-fg"
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${active ? "text-accent-from" : "opacity-0"}`}
                />
                <span className="flex-1">{opt.label}</span>
                {opt.description && (
                  <span className="text-[9px] text-fg-subtle">{opt.description}</span>
                )}
              </DropdownMenu.Item>
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
    <div className="flex shrink-0 items-center gap-2.5 overflow-hidden border-b border-border bg-bg/30 px-3 py-1.5 font-mono text-[9px] text-fg-subtle">
      {withSeparators}
    </div>
  );
}

function ChipLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-fg-subtle/60">{children}</span>;
}

/**
 * Small state dot next to the model chip. Solid muted when idle; pulses
 * accent-violet while the session has a streaming assistant message.
 */
function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
        active ? "animate-pulse bg-accent-from" : "bg-fg-subtle/50"
      }`}
      aria-hidden
    />
  );
}

function CompactBody({ sessionId, data }: { sessionId: string; data: SessionNodeData }) {
  const ids = useMessagesStore((s) => s.bySession[sessionId] ?? EMPTY_IDS);
  const byId = useMessagesStore((s) => s.byId);
  const isStreaming = useMessagesStore((s) => !!s.streamingSessions[sessionId]);

  // Show the most recent user prompt + the most recent assistant response.
  // This is enough to know what a node is at a glance without unfurling.
  let lastUser: string | null = null;
  let lastAssistant: string | null = null;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const m = byId[ids[i]];
    if (!m) continue;
    if (!lastAssistant && m.role === "assistant") lastAssistant = m.content;
    else if (!lastUser && m.role === "user") lastUser = m.content;
    if (lastUser && lastAssistant) break;
  }

  const truncate = (s: string, n: number) =>
    s.length > n ? `${s.slice(0, n).trim()}…` : s;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 py-4">
      {lastUser ? (
        <div className="space-y-1">
          <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
            you
          </div>
          <div className="line-clamp-2 font-mono text-[12px] text-fg">
            {truncate(lastUser, 160)}
          </div>
        </div>
      ) : (
        <div className="font-mono text-[11px] text-fg-subtle">empty session</div>
      )}

      {lastAssistant && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[9px] uppercase tracking-wider text-fg-subtle">
              {data.modelId}
            </div>
            {isStreaming && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-from" />
            )}
          </div>
          <div className="line-clamp-10 font-sans text-[12.5px] leading-relaxed text-fg">
            {truncate(lastAssistant, 600)}
          </div>
        </div>
      )}

      {!lastUser && !lastAssistant && isStreaming && (
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-fg-subtle">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-from" />
          streaming…
        </div>
      )}
    </div>
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
