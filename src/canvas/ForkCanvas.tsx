import {
  ReactFlow,
  Controls,
  MiniMap,
  Panel,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../chrome/ConfirmDialog";
import { useMessagesStore } from "../state/messagesStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import { CrossGrid } from "./background/CrossGrid";
import { EmptyState } from "./EmptyState";
import { LineageEdge, type LineageEdgeType } from "./edges/LineageEdge";
import { SessionNode, type SessionNodeType } from "./nodes/SessionNode";

const nodeTypes = { session: SessionNode };
const edgeTypes = { lineage: LineageEdge };

// Hoist all of ReactFlow's stable-by-design props to module level. Passing
// new object / array / function references on every render makes ReactFlow's
// internal effects re-run and can cascade into 'Maximum update depth exceeded'.
const PRO_OPTIONS = { hideAttribution: true } as const;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const;
const PAN_ON_DRAG: number[] = [1, 2];

function sameIds(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

// Click on a node that isn't already in the comfort zone of the viewport →
// animate to bring it to center. Works at any zoom level: a cell peeking in
// from the screen edge becomes clickable and snaps to the middle without the
// user having to pan there manually. Already-centered cells stay put so
// normal interaction (selecting, clicking on chat content) isn't disturbed.
const OFF_CENTER_FRACTION = 0.15; // 15% of screen size from the middle

export function ForkCanvas() {
  const sessions = useWorkspaceStore((s) => s.sessions);
  const updatePosition = useWorkspaceStore((s) => s.updateSessionPosition);
  const mergeSessions = useWorkspaceStore((s) => s.mergeSessions);
  const removeSession = useWorkspaceStore((s) => s.removeSession);
  const flow = useReactFlow();
  // Subscribe ONLY to start/stop transitions, not to every token delta —
  // edges depend on this, so observing per-delta state caused the infinite
  // render storm + 12GB memory blowout.
  const streamingSessions = useMessagesStore((s) => s.streamingSessions);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [deleteCandidates, setDeleteCandidates] = useState<string[] | null>(null);

  // Cache of measured dimensions per node. xyflow emits dimension changes
  // once it has rendered + measured a node; we stash them here and merge
  // them back into the next nodes prop. Without this, every render rebuilds
  // nodes from `sessions` with no `measured` field, and dragging a node
  // before its next render cycle triggers xyflow's "node not initialized"
  // warning.
  const measuredRef = useRef<Map<string, { width: number; height: number }>>(
    new Map(),
  );

  const nodes = useMemo<SessionNodeType[]>(
    () =>
      Object.values(sessions).map((s) => {
        const measured = measuredRef.current.get(s.id);
        return {
          id: s.id,
          type: "session",
          position: s.position,
          data: { title: s.title, providerId: s.providerId, modelId: s.modelId },
          ...(measured ? { measured } : {}),
        };
      }),
    [sessions],
  );

  const edges = useMemo<LineageEdgeType[]>(() => {
    const out: LineageEdgeType[] = [];
    for (const s of Object.values(sessions)) {
      const childIsStreaming = !!streamingSessions[s.id];
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
  }, [sessions, streamingSessions]);

  const onNodesChange = useCallback(
    (changes: NodeChange<SessionNodeType>[]) => {
      // Capture dimension changes into our cache so the next render of
      // `nodes` carries them through. Position changes go to the workspace
      // store (debounced persistence). Other changes (select, etc.) xyflow
      // tracks internally — we don't need to mirror them.
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions) {
          measuredRef.current.set(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          });
        }
      }
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

  // ReactFlow fires onSelectionChange whenever its internal selection store
  // ticks — including spurious fires during render. We guard with an
  // identity check so unchanged selections never enqueue a setState and
  // we never trigger React's infinite-loop detector.
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      const newIds = selectedNodes.map((n) => n.id);
      setSelectedNodeIds((prev) => (sameIds(prev, newIds) ? prev : newIds));
    },
    [],
  );

  // Click-to-focus: re-centre the clicked node if it's currently visually
  // off-centre (peeking in from a screen edge, or far from the middle).
  // Already-centred nodes are skipped so clicking inside a node you're
  // already reading doesn't yank the viewport around.
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const live = flow.getNode(node.id) ?? node;
      const { x: vpX, y: vpY, zoom } = flow.getViewport();
      // Node dimensions: prefer the measured size xyflow tracks, fall back
      // to width/height fields on the node (set by NodeResizer), then to
      // a sensible default.
      const nWidth = live.measured?.width ?? live.width ?? 560;
      const nHeight = live.measured?.height ?? live.height ?? 400;
      const screenCenterX = (live.position.x + nWidth / 2) * zoom + vpX;
      const screenCenterY = (live.position.y + nHeight / 2) * zoom + vpY;
      const winCenterX = window.innerWidth / 2;
      const winCenterY = window.innerHeight / 2;
      const dx = Math.abs(screenCenterX - winCenterX);
      const dy = Math.abs(screenCenterY - winCenterY);
      const offCenter =
        dx > window.innerWidth * OFF_CENTER_FRACTION ||
        dy > window.innerHeight * OFF_CENTER_FRACTION;
      if (!offCenter) return;
      // Re-centre at the current zoom — the user picked their zoom, we don't
      // change it. Just slide the viewport so this node lands in the middle.
      flow.setCenter(
        live.position.x + nWidth / 2,
        live.position.y + nHeight / 2,
        { duration: 420, zoom },
      );
    },
    [flow],
  );

  // Canvas-level keyboard shortcuts.
  //  - M (no modifiers, 2+ nodes selected): spawn a merge synthesis
  //  - Delete / Backspace (1+ nodes selected): trigger delete confirm dialog
  useEffect(() => {
    const isTypingTarget = (el: HTMLElement | null) =>
      !!el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (isTypingTarget(tgt)) return;

      // Merge
      if (e.key.toLowerCase() === "m" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (selectedNodeIds.length < 2) return;
        e.preventDefault();
        mergeSessions(selectedNodeIds).catch((err) =>
          console.error("merge failed", err),
        );
        return;
      }

      // Delete via Delete or Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selectedNodeIds.length === 0) return;
        e.preventDefault();
        setDeleteCandidates(selectedNodeIds);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNodeIds, mergeSessions]);

  const handleConfirmDelete = useCallback(async () => {
    const ids = deleteCandidates ?? [];
    await Promise.all(
      ids.map((id) =>
        removeSession(id).catch((err) => {
          console.error(`delete session ${id} failed`, err);
        }),
      ),
    );
    setDeleteCandidates(null);
  }, [deleteCandidates, removeSession]);

  const isEmpty = nodes.length === 0;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onSelectionChange={onSelectionChange}
      onNodeClick={onNodeClick}
      proOptions={PRO_OPTIONS}
      minZoom={0.1}
      maxZoom={2.5}
      defaultViewport={DEFAULT_VIEWPORT}
      panOnScroll
      panOnScrollSpeed={0.7}
      zoomOnPinch
      zoomOnScroll={false}
      zoomOnDoubleClick={false}
      preventScrolling
      selectionOnDrag
      panOnDrag={PAN_ON_DRAG}
      // We handle delete ourselves to show a confirm dialog before destroying state.
      deleteKeyCode={null}
    >
      <CrossGrid />
      {isEmpty && <EmptyState />}
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
      <ConfirmDialog
        open={deleteCandidates !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidates(null);
        }}
        title={
          (deleteCandidates?.length ?? 0) > 1
            ? `delete ${deleteCandidates?.length} sessions?`
            : "delete this session?"
        }
        description={
          <>
            This permanently removes the selected{" "}
            {(deleteCandidates?.length ?? 0) > 1 ? "sessions" : "session"} and all
            their messages. Any forks descending from them stay on the canvas
            but no longer share lineage.
          </>
        }
        confirmLabel="delete"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </ReactFlow>
  );
}
