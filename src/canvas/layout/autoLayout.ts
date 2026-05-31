import dagre from "dagre";
import type { Session, SessionId } from "../../state/workspaceStore";

/**
 * Lay out a set of sessions as a left-to-right tree using dagre. Honours
 * `position_locked` by computing positions for every node BUT only emitting
 * updates for unlocked ones — locked nodes stay where the user dragged them.
 *
 * Edge sources for layout:
 *  - parent_session_id → child (linear fork lineage)
 *  - each merge_source_session_id → merge child (the funnel)
 *
 * Defaults: 560x400 cell footprint. MUST match SessionNode's DEFAULT_WIDTH /
 * DEFAULT_HEIGHT — fresh sessions have width/height === null until the user
 * resizes, so a mismatch makes Reorganize (⌘⇧L) space default cells by the
 * wrong footprint and they overlap. User-resized cells use their real size.
 */
const DEFAULT_W = 560;
const DEFAULT_H = 400;
const RANK_SEP = 120;
const NODE_SEP = 60;

export interface AutoLayoutResult {
  /** Map of session id → new position. Only includes UNLOCKED sessions. */
  positions: Record<SessionId, { x: number; y: number }>;
}

export function autoLayout(sessions: Session[], locked: Set<SessionId>): AutoLayoutResult {
  if (sessions.length === 0) return { positions: {} };

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const s of sessions) {
    g.setNode(s.id, {
      width: s.width ?? DEFAULT_W,
      height: s.height ?? DEFAULT_H,
    });
  }

  // Edges: linear forks + merge sources.
  for (const s of sessions) {
    if (s.parentSessionId && g.hasNode(s.parentSessionId)) {
      g.setEdge(s.parentSessionId, s.id);
    }
    for (const src of s.mergeSourceSessionIds) {
      if (g.hasNode(src)) {
        g.setEdge(src, s.id);
      }
    }
  }

  dagre.layout(g);

  const positions: Record<SessionId, { x: number; y: number }> = {};
  for (const s of sessions) {
    if (locked.has(s.id)) continue;
    const d = g.node(s.id);
    if (!d) continue;
    // dagre returns center coordinates; xyflow expects top-left.
    positions[s.id] = {
      x: d.x - (s.width ?? DEFAULT_W) / 2,
      y: d.y - (s.height ?? DEFAULT_H) / 2,
    };
  }

  return { positions };
}
