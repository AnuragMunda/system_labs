"use client";

// Custom canvas edge for the editor. Renders a smooth-step base line, an optional
// protocol label at the midpoint, and — while a simulation runs — an animated
// request particle travelling along the path (via SVG <animateMotion>).
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { HEALTH_STYLES } from "@/lib/health";
import type { EditorEdge } from "../../types";

export function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<EditorEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const live = data?.live;
  const flowing = Boolean(data?.flowing);
  const protocol = data?.protocol ?? "http";
  const rps = live ? live.rps : data?.trafficRate ?? 0;
  // Packets traverse slower on higher-latency connections, clamped so the
  // animation stays readable at both extremes.
  const durationSec = Math.min(
    2.2,
    Math.max(0.9, 0.6 + (live?.latency ?? 0) / 250),
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "var(--color-primary)" : "var(--color-border-strong)",
          strokeWidth: selected ? 2 : 1.5,
        }}
      />
      {flowing ? (
        <>
          <BaseEdge
            id={`${id}-flow`}
            path={edgePath}
            className="animate-flow"
            style={{ stroke: HEALTH_STYLES.healthy.edgeVar, strokeWidth: 1.5 }}
          />
          {[0, 0.5, 1].map((begin) => (
            <circle
              key={begin}
              r={2.5}
              fill="var(--color-primary)"
              style={{ pointerEvents: "none" }}
            >
              <animateMotion
                dur={`${durationSec}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
                path={edgePath}
              />
            </circle>
          ))}
        </>
      ) : null}

      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          className={`pointer-events-none absolute flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground ${
            live ? "border-primary/40 text-primary" : ""
          }`}
        >
          <span className="uppercase">{protocol}</span>
          {rps > 0 ? <span>· {rps.toLocaleString()}/s</span> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
