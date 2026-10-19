"use client";

// Custom canvas node for the editor. Shows the component icon, name, type label,
// health dot, and a small metrics strip (traffic / latency / replicas). While a
// simulation runs, `data.live` overrides the baseline readouts.
import { createElement } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { HEALTH_STYLES } from "@/lib/health";
import { getCatalogIcon, getCatalogLabel } from "../../catalog";
import type { EditorNode } from "../../types";

export function ComponentNode({ data, selected }: NodeProps<EditorNode>) {
  const styles = HEALTH_STYLES[data.health];
  const live = data.live;
  const rps = live ? live.rps : Math.round(data.traffic);
  const p95 = live ? live.p95 : data.latencyMs;
  const cpu = live ? live.cpu : Math.round(data.cpu);
  return (
    <div
      className={`w-48 rounded-md border bg-card/95 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] transition-colors ${
        selected ? "border-primary ring-1 ring-primary" : styles.border
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-border-strong !bg-muted-foreground"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-border-strong !bg-muted-foreground"
      />

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {createElement(getCatalogIcon(data.kind), {
          className: `size-3.5 ${styles.icon}`,
          "aria-hidden": true,
        })}
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {data.label}
        </span>
        <span
          className={`size-1.5 rounded-full ${styles.dot} animate-pulse-dot`}
          aria-label={styles.label}
          role="status"
        />
      </div>

      <div className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {getCatalogLabel(data.kind)}
      </div>

      <div className="grid grid-cols-3 gap-x-2 gap-y-1 px-3 pb-2 font-mono text-[10px] leading-none text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <span>req/s</span>
          <span className="text-foreground">{rps.toLocaleString()}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span>p95</span>
          <span className={styles.value}>{p95}ms</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span>cpu</span>
          <span className="text-foreground">
            {cpu === undefined ? "—" : `${cpu}%`}
          </span>
        </div>
        <div className="col-span-3 flex items-center justify-between border-t border-border pt-1 text-[10px]">
          <span>replicas ×{data.replicas}</span>
          <span className="text-muted-foreground">{data.region}</span>
        </div>
      </div>
    </div>
  );
}
