import {
  ReactFlow,
  Controls,
  MiniMap,
  Panel,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { useWorkspaceStore } from "../state/workspaceStore";
import { SessionNode, type SessionNodeType } from "./nodes/SessionNode";
import { CrossGrid } from "./background/CrossGrid";

const nodeTypes = { session: SessionNode };

export function ForkCanvas() {
  const sessions = useWorkspaceStore((s) => s.sessions);
  const updatePosition = useWorkspaceStore((s) => s.updateSessionPosition);

  const nodes = useMemo<SessionNodeType[]>(
    () =>
      Object.values(sessions).map((s) => ({
        id: s.id,
        type: "session",
        position: s.position,
        data: { title: s.title, providerId: s.providerId, modelId: s.modelId },
      })),
    [sessions],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<SessionNodeType>[]) => {
      const next = applyNodeChanges(changes, nodes) as Node[];
      for (const node of next) {
        const orig = sessions[node.id];
        if (!orig) continue;
        if (orig.position.x !== node.position.x || orig.position.y !== node.position.y) {
          updatePosition(node.id, node.position);
        }
      }
    },
    [nodes, sessions, updatePosition],
  );

  const isEmpty = nodes.length === 0;

  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      proOptions={{ hideAttribution: true }}
      minZoom={0.1}
      maxZoom={2.5}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      panOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      selectionOnDrag
      panOnDrag={[1, 2]}
    >
      <CrossGrid />
      {isEmpty && (
        <Panel position="top-center" className="!top-1/2 !-translate-y-1/2">
          <div className="select-none rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 px-4 py-2 font-mono text-xs text-[var(--color-fg-subtle)] backdrop-blur">
            press{" "}
            <kbd className="mx-0.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-1.5 py-[1px] text-[10px] text-[var(--color-fg-muted)]">
              + new session
            </kbd>{" "}
            to start
          </div>
        </Panel>
      )}
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="!overflow-hidden !rounded-lg !border !border-[var(--color-border)] !bg-[var(--color-bg-elevated)] !shadow-[0_4px_16px_-6px_rgba(0,0,0,0.5)]"
      />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="!overflow-hidden !rounded-lg !border !border-[var(--color-border)] !bg-[var(--color-bg-elevated)] !shadow-[0_4px_16px_-6px_rgba(0,0,0,0.5)]"
        maskColor="color-mix(in srgb, var(--color-bg) 75%, transparent)"
        nodeColor="var(--color-fg-muted)"
        nodeStrokeColor="transparent"
      />
    </ReactFlow>
  );
}
