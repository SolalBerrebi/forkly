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
import { useMessagesStore } from "../state/messagesStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import { LineageEdge, type LineageEdgeType } from "./edges/LineageEdge";
import { SessionNode, type SessionNodeType } from "./nodes/SessionNode";
import { CrossGrid } from "./background/CrossGrid";

const nodeTypes = { session: SessionNode };
const edgeTypes = { lineage: LineageEdge };

export function ForkCanvas() {
  const sessions = useWorkspaceStore((s) => s.sessions);
  const updatePosition = useWorkspaceStore((s) => s.updateSessionPosition);
  const streamingByMsg = useMessagesStore((s) => s.streaming);
  const msgBySession = useMessagesStore((s) => s.bySession);

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

  // Derive edges from parent_session_id. The lineage thread becomes
  // animated when the child has a currently-streaming assistant message —
  // that's the visual cue that tokens are flowing from the parent context
  // into the new branch.
  const edges = useMemo<LineageEdgeType[]>(
    () =>
      Object.values(sessions)
        .filter((s) => s.parentSessionId)
        .map((s) => {
          const ids = msgBySession[s.id] ?? [];
          const streaming = ids.some((mid) => !!streamingByMsg[mid]);
          return {
            id: `lineage-${s.parentSessionId}-${s.id}`,
            source: s.parentSessionId!,
            target: s.id,
            type: "lineage",
            data: { streaming },
          };
        }),
    [sessions, msgBySession, streamingByMsg],
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
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
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
        <Panel position="top-center" className="top-1/2! -translate-y-1/2!">
          <div className="select-none rounded-full border border-border bg-bg-elevated/60 px-4 py-2 font-mono text-xs text-fg-subtle backdrop-blur">
            press{" "}
            <kbd className="mx-0.5 rounded border border-border-strong bg-bg px-1.5 py-px text-[10px] text-fg-muted">
              + new session
            </kbd>{" "}
            to start
          </div>
        </Panel>
      )}
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="overflow-hidden! rounded-lg! border! border-border! bg-bg-elevated! shadow-[0_4px_16px_-6px_rgba(0,0,0,0.5)]!"
      />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="overflow-hidden! rounded-lg! border! border-border! bg-bg-elevated! shadow-[0_4px_16px_-6px_rgba(0,0,0,0.5)]!"
        maskColor="color-mix(in srgb, var(--color-bg) 75%, transparent)"
        nodeColor="var(--color-fg-muted)"
        nodeStrokeColor="transparent"
      />
    </ReactFlow>
  );
}
