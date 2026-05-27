import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { GitFork } from "lucide-react";
import { ChatView } from "../../chat/ChatView";

export interface SessionNodeData extends Record<string, unknown> {
  title: string;
  providerId: string;
  modelId: string;
}

export type SessionNodeType = Node<SessionNodeData, "session">;

export function SessionNode({ id, data, selected }: NodeProps<SessionNodeType>) {
  return (
    <div
      className={[
        "group relative flex h-[460px] w-90 flex-col overflow-hidden rounded-[12px] border bg-bg-elevated",
        "shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] transition-all duration-200",
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

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-bg text-accent-from">
          <GitFork className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 truncate font-mono text-xs text-fg">{data.title}</div>
        <div className="rounded-full bg-bg px-2 py-0.5 font-mono text-[10px] tracking-tight text-fg-muted">
          {data.providerId}
        </div>
      </div>

      <ChatView sessionId={id} />
    </div>
  );
}
