import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Handle,
  Position,
  useStore,
  type Node,
  type NodeProps,
  type ReactFlowState,
} from "@xyflow/react";
import { motion } from "framer-motion";
import { GitFork, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { ChatView } from "../../chat/ChatView";
import { ConfirmDialog } from "../../chrome/ConfirmDialog";
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

export function SessionNode({ id, data, selected }: NodeProps<SessionNodeType>) {
  const zoom = useStore(zoomSelector);
  const removeSession = useWorkspaceStore((s) => s.removeSession);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const mode: "full" | "compact" | "label" =
    zoom >= FULL_MIN_ZOOM ? "full" : zoom >= COMPACT_MIN_ZOOM ? "compact" : "label";

  const handleDelete = async () => {
    try {
      await removeSession(id);
    } catch (err) {
      console.error("delete session failed", err);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={[
          "group relative flex h-115 w-90 flex-col overflow-hidden rounded-[12px] border bg-bg-elevated",
          "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] transition-[border-color,box-shadow] duration-200",
          selected
            ? "border-transparent ring-1 ring-accent-from shadow-[0_0_0_1px_var(--color-accent-from),0_0_60px_-8px_color-mix(in_srgb,var(--color-accent-from)_55%,transparent)]"
            : "border-border hover:border-border-strong",
        ].join(" ")}
      >
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
          <div className="rounded-full bg-bg px-2 py-0.5 font-mono text-[10px] tracking-tight text-fg-muted">
            {data.providerId}
          </div>
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
