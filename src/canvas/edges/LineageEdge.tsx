import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export interface LineageEdgeData extends Record<string, unknown> {
  streaming: boolean;
}

export type LineageEdgeType = Edge<LineageEdgeData, "lineage">;

export function LineageEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<LineageEdgeType>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const gradientId = `lineage-gradient-${id}`;
  const isStreaming = !!data?.streaming;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--color-accent-from)" />
          <stop offset="100%" stopColor="var(--color-accent-to)" />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: 1.5,
          ...(isStreaming && {
            strokeDasharray: "6 4",
            animation: "lineage-flow 0.7s linear infinite",
          }),
        }}
      />
    </>
  );
}
