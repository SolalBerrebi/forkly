import {
  ReactFlow,
  Controls,
  MiniMap,
  Panel,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const mergeSessions = useWorkspaceStore((s) => s.mergeSessions);
  const streamingByMsg = useMessagesStore((s) => s.streaming);
  const msgBySession = useMessagesStore((s) => s.bySession);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

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

  // Derive edges from both linear forks (parent_session_id) AND merge
  // sources (merge_source_session_ids). A merge node ends up with N
  // incoming edges, which xyflow renders as the visual funnel.
  const edges = useMemo<LineageEdgeType[]>(() => {
    const out: LineageEdgeType[] = [];
    for (const s of Object.values(sessions)) {
      const childIds = msgBySession[s.id] ?? [];
      const childIsStreaming = childIds.some((mid) => !!streamingByMsg[mid]);

      if (s.parentSessionId) {
        out.push({
          id: `lineage-${s.parentSessionId}-${s.id}`,
          source: s.parentSessionId,
          target: s.id,
          type: "lineage",
          data: { streaming: childIsStreaming },
        });
      }
      for (const srcId of s.mergeSourceSessionIds) {
        out.push({
          id: `merge-${srcId}-${s.id}`,
          source: srcId,
          target: s.id,
          type: "lineage",
          data: { streaming: childIsStreaming },
        });
      }
    }
    return out;
  }, [sessions, msgBySession, streamingByMsg]);

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

  // M shortcut: when 2+ session nodes are selected, press M to spawn a
  // merge node that synthesizes their final responses.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      ) {
        return;
      }
      if (selectedNodeIds.length < 2) return;
      e.preventDefault();
      mergeSessions(selectedNodeIds).catch((err) => {
        console.error("merge failed", err);
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeIds, mergeSessions]);

  const isEmpty = nodes.length === 0;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onSelectionChange={({ nodes: selectedNodes }) =>
        setSelectedNodeIds(selectedNodes.map((n) => n.id))
      }
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
      {selectedNodeIds.length >= 2 && (
        <Panel position="top-center" className="top-3!">
          <div className="select-none rounded-full border border-accent-from/40 bg-bg-elevated/80 px-3 py-1.5 font-mono text-[11px] text-fg backdrop-blur">
            {selectedNodeIds.length} selected · press{" "}
            <kbd className="mx-0.5 rounded border border-accent-from/40 bg-bg px-1.5 py-px text-[10px] text-accent-from">
              M
            </kbd>{" "}
            to merge
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
