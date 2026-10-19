"use client";

// Right inspector panel. Context-sensitive:
//  - nothing selected → "Architecture" summary (node/connection counts, health, cost)
//  - node selected → tabbed config (Overview / Configuration / Scaling / Networking /
//    Reliability / Observability) + Dependencies + Inject Failure
//  - edge selected → protocol / traffic / latency + delete
// Every editable field dispatches `updateNodeData` / `updateEdgeData`; focus fires a
// single history snapshot so an edit session collapses into one undo step.
import { useState } from "react";
import { Trash2, ArrowDownRight, ArrowUpRight, PanelRightClose, PanelRightOpen } from "lucide-react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  beginEdit,
  deleteSelected,
  setSelection,
  snapshot,
  updateEdgeData,
  updateNodeData,
} from "@/store/editorSlice";
import { HEALTH_STYLES } from "@/lib/health";
import type { Health } from "@/lib/health";
import { getCatalogLabel } from "../catalog";
import { computeBaselineTelemetry } from "../telemetry";
import type {
  EditorEdge,
  EditorEdgeData,
  EditorNode,
  EditorNodeData,
  Protocol,
  RoutingStrategy,
} from "../types";

const HEALTH_RANK: Record<Health, number> = { healthy: 0, degraded: 1, critical: 2 };
const ROUTING_STRATEGIES: { value: RoutingStrategy; label: string }[] = [
  { value: "round_robin", label: "Round robin" },
  { value: "random", label: "Random" },
  { value: "least_connections", label: "Least connections" },
];
const PROTOCOLS: Protocol[] = [
  "http",
  "https",
  "grpc",
  "tcp",
  "ws",
  "kafka",
  "amqp",
  "sql",
  "redis",
  "custom",
];

function worstHealth(healths: Health[]): Health {
  return healths.reduce<Health>(
    (worst, h) => (HEALTH_RANK[h] > HEALTH_RANK[worst] ? h : worst),
    "healthy",
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-sm border border-border bg-muted px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-border-strong";

export function Inspector({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const node = useAppSelector(
    (s) => s.editor.nodes.find((n) => n.id === s.editor.selectedNodeId) ?? null,
  );
  const edge = useAppSelector(
    (s) => s.editor.edges.find((e) => e.id === s.editor.selectedEdgeId) ?? null,
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Open inspector"
        className="flex w-9 shrink-0 flex-col items-center justify-center gap-2 border-l border-border bg-card text-primary transition-colors hover:bg-muted"
      >
        <PanelRightOpen className="size-4" aria-hidden="true" />
        <span className="text-[15px] uppercase tracking-wider [writing-mode:vertical-rl]">
          Inspector
        </span>
      </button>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-end border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse inspector"
          className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="size-4" aria-hidden="true" />
        </button>
      </div>
      {node ? (
        <NodeInspector node={node} />
      ) : edge ? (
        <EdgeInspector edge={edge} />
      ) : (
        <ArchitectureSummary />
      )}
    </aside>
  );
}

function ArchitectureSummary() {
  const nodes = useAppSelector((s) => s.editor.nodes);
  const edges = useAppSelector((s) => s.editor.edges);
  const health = worstHealth(nodes.map((n) => n.data.health));
  const styles = HEALTH_STYLES[health];
  const cost = computeBaselineTelemetry(nodes).cost;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Architecture
        </h2>
        <p className="text-xs text-muted-foreground">Overview &amp; estimates</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Nodes" value={String(nodes.length)} />
        <Stat label="Connections" value={String(edges.length)} />
        <div className="rounded-sm border border-border bg-muted/40 p-2.5">
          <p className="text-xs text-muted-foreground">Health</p>
          <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${styles.value}`}>
            <span className={`size-2 rounded-full ${styles.dot}`} />
            {styles.label}
          </p>
        </div>
        <Stat label="Est. Cost" value={`$${Math.round(cost).toLocaleString()}/mo`} />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Select a component to inspect and edit its configuration, performance and
        dependencies. Drag components from the left palette to grow your architecture.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-muted/40 p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

const TABS = [
  "Overview",
  "Configuration",
  "Scaling",
  "Networking",
  "Reliability",
  "Observability",
] as const;
type Tab = (typeof TABS)[number];

function NodeInspector({ node }: { node: EditorNode }) {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<Tab>("Overview");
  const edges = useAppSelector((s) => s.editor.edges);
  const nodes = useAppSelector((s) => s.editor.nodes);
  const d = node.data;
  const styles = HEALTH_STYLES[d.health];
  const live = d.live;

  const patch = (p: Partial<EditorNodeData>) =>
    dispatch(updateNodeData({ id: node.id, patch: p }));
  const onFocus = () => dispatch(beginEdit());

  const incoming = edges.filter((e) => e.target === node.id);
  const outgoing = edges.filter((e) => e.source === node.id);
  const labelOf = (id: string) =>
    nodes.find((n) => n.id === id)?.data.label ?? id;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {d.label}
          </h2>
          <span className={`flex items-center gap-1.5 text-xs ${styles.value}`}>
            <span className={`size-2 rounded-full ${styles.dot} animate-pulse-dot`} />
            {styles.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{getCatalogLabel(d.kind)}</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
              tab === t
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {tab === "Overview" ? (
          <>
            <FieldRow label="Health">
              <div className={`flex items-center gap-1.5 text-sm ${styles.value}`}>
                <span className={`size-2 rounded-full ${styles.dot}`} />
                {styles.label}
              </div>
            </FieldRow>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Requests" value={`${live ? live.rps : Math.round(d.traffic)} req/s`} />
              <Stat label="P95" value={`${live ? live.p95 : d.latencyMs}ms`} />
              <Stat label="P50" value={`${live ? live.p50 : Math.round(d.latencyMs * 0.6)}ms`} />
              <Stat label="Error rate" value={`${((live ? live.errorRate : d.errorRate ?? 0) * 100).toFixed(2)}%`} />
            </div>
          </>
        ) : null}

        {tab === "Configuration" ? (
          <>
            <FieldRow label="Type">
              <div className={`${inputCls} flex items-center text-muted-foreground`}>
                {getCatalogLabel(d.kind)}
              </div>
            </FieldRow>
            <FieldRow label="Replicas">
              <input
                type="number"
                min={1}
                value={d.replicas}
                onFocus={onFocus}
                onChange={(e) => patch({ replicas: Math.max(1, Number(e.target.value) || 1) })}
                className={inputCls}
              />
            </FieldRow>
            <div className="grid grid-cols-2 gap-2">
              <FieldRow label="CPU (cores)">
                <input
                  type="number"
                  min={0}
                  value={d.cpu}
                  onFocus={onFocus}
                  onChange={(e) => patch({ cpu: Math.max(0, Number(e.target.value) || 0) })}
                  className={inputCls}
                />
              </FieldRow>
              <FieldRow label="Memory (GB)">
                <input
                  type="number"
                  min={0}
                  value={d.memory}
                  onFocus={onFocus}
                  onChange={(e) => patch({ memory: Math.max(0, Number(e.target.value) || 0) })}
                  className={inputCls}
                />
              </FieldRow>
            </div>
          </>
        ) : null}

        {tab === "Scaling" ? (
          <>
            <label className="flex items-center justify-between rounded-sm border border-border bg-muted/40 px-2.5 py-2">
              <span className="text-sm text-foreground">Autoscaling</span>
              <input
                type="checkbox"
                checked={d.autoscaling.enabled}
                onChange={(e) =>
                  patch({ autoscaling: { ...d.autoscaling, enabled: e.target.checked } })
                }
                className="size-4 accent-[var(--color-primary)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <FieldRow label="Min replicas">
                <input
                  type="number"
                  min={1}
                  value={d.autoscaling.min}
                  onFocus={onFocus}
                  onChange={(e) =>
                    patch({
                      autoscaling: {
                        ...d.autoscaling,
                        min: Math.max(1, Number(e.target.value) || 1),
                      },
                    })
                  }
                  className={inputCls}
                />
              </FieldRow>
              <FieldRow label="Max replicas">
                <input
                  type="number"
                  min={1}
                  value={d.autoscaling.max}
                  onFocus={onFocus}
                  onChange={(e) =>
                    patch({
                      autoscaling: {
                        ...d.autoscaling,
                        max: Math.max(1, Number(e.target.value) || 1),
                      },
                    })
                  }
                  className={inputCls}
                />
              </FieldRow>
            </div>
            <FieldRow label="Target CPU (%)">
              <input
                type="number"
                min={1}
                max={100}
                value={d.autoscaling.targetCpu}
                onFocus={onFocus}
                onChange={(e) =>
                  patch({
                    autoscaling: {
                      ...d.autoscaling,
                      targetCpu: Math.min(100, Math.max(1, Number(e.target.value) || 1)),
                    },
                  })
                }
                className={inputCls}
              />
            </FieldRow>
          </>
        ) : null}

        {tab === "Networking" ? (
          <>
            <FieldRow label="Region">
              <input
                value={d.region}
                onFocus={onFocus}
                onChange={(e) => patch({ region: e.target.value })}
                className={inputCls}
              />
            </FieldRow>
            <FieldRow label="Routing strategy">
              <select
                value={d.routingStrategy}
                onChange={(e) =>
                  patch({ routingStrategy: e.target.value as RoutingStrategy })
                }
                className={inputCls}
              >
                {ROUTING_STRATEGIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FieldRow>
            {outgoing.length > 1 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Used to choose among this component&apos;s {outgoing.length}{" "}
                outgoing connections.
              </p>
            ) : null}
          </>
        ) : null}

        {tab === "Reliability" ? (
          <>
            <FieldRow label="Retries">
              <input
                type="number"
                min={0}
                value={d.retryPolicy.retries}
                onFocus={onFocus}
                onChange={(e) =>
                  patch({
                    retryPolicy: {
                      ...d.retryPolicy,
                      retries: Math.max(0, Number(e.target.value) || 0),
                    },
                  })
                }
                className={inputCls}
              />
            </FieldRow>
            <FieldRow label="Timeout (ms)">
              <input
                type="number"
                min={0}
                value={d.timeoutMs}
                onFocus={onFocus}
                onChange={(e) => patch({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })}
                className={inputCls}
              />
            </FieldRow>
            <label className="flex items-center justify-between rounded-sm border border-border bg-muted/40 px-2.5 py-2">
              <span className="text-sm text-foreground">Circuit Breaker</span>
              <input
                type="checkbox"
                checked={d.retryPolicy.circuitBreaker}
                onChange={(e) =>
                  patch({
                    retryPolicy: { ...d.retryPolicy, circuitBreaker: e.target.checked },
                  })
                }
                className="size-4 accent-[var(--color-primary)]"
              />
            </label>
          </>
        ) : null}

        {tab === "Observability" ? (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="P50" value={`${live ? live.p50 : Math.round(d.latencyMs * 0.6)}ms`} />
            <Stat label="P95" value={`${live ? live.p95 : d.latencyMs}ms`} />
            <Stat label="P99" value={`${live ? live.p99 : Math.round(d.latencyMs * 1.8)}ms`} />
            <Stat label="Error rate" value={`${((live ? live.errorRate : d.errorRate ?? 0) * 100).toFixed(2)}%`} />
            <Stat label="CPU" value={live ? (live.cpu === undefined ? "—" : `${live.cpu}%`) : `${Math.round(d.cpu)}%`} />
            <Stat label="Memory" value={live ? (live.memory === undefined ? "—" : `${live.memory}%`) : `${Math.round(d.memory)}%`} />
          </div>
        ) : null}

        <div className="mt-1 border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dependencies
          </p>
          <DependencyList
            title="Incoming"
            icon={<ArrowUpRight className="size-3.5" />}
            ids={incoming.map((e) => e.source)}
            labelOf={labelOf}
            onSelect={(id) => dispatch(setSelection({ nodeId: id, edgeId: null }))}
          />
          <DependencyList
            title="Outgoing"
            icon={<ArrowDownRight className="size-3.5" />}
            ids={outgoing.map((e) => e.target)}
            labelOf={labelOf}
            onSelect={(id) => dispatch(setSelection({ nodeId: id, edgeId: null }))}
          />
        </div>
      </div>
    </div>
  );
}

function DependencyList({
  title,
  icon,
  ids,
  labelOf,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  ids: string[];
  labelOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {title}
      </p>
      {ids.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ids.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                className="w-full truncate rounded-sm border border-border bg-muted/30 px-2 py-1 text-left text-xs text-foreground transition-colors hover:border-border-strong hover:bg-muted"
              >
                {labelOf(id)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EdgeInspector({ edge }: { edge: EditorEdge }) {
  const dispatch = useAppDispatch();
  const nodes = useAppSelector((s) => s.editor.nodes);
  const d = edge.data ?? ({ protocol: "http", trafficRate: 0, latencyMs: 10 } as EditorEdgeData);
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? id;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Connection</h2>
        <p className="truncate text-xs text-muted-foreground">
          {labelOf(edge.source)} → {labelOf(edge.target)}
        </p>
      </div>

      <FieldRow label="Protocol">
        <select
          value={d.protocol}
          onChange={(e) =>
            dispatch(updateEdgeData({ id: edge.id, patch: { protocol: e.target.value as Protocol } }))
          }
          className={inputCls}
        >
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Traffic rate (req/s)">
        <input
          type="number"
          min={0}
          value={d.trafficRate}
          onFocus={() => dispatch(beginEdit())}
          onChange={(e) =>
            dispatch(
              updateEdgeData({
                id: edge.id,
                patch: { trafficRate: Math.max(0, Number(e.target.value) || 0) },
              }),
            )
          }
          className={inputCls}
        />
      </FieldRow>
      <FieldRow label="Latency (ms)">
        <input
          type="number"
          min={0}
          value={d.latencyMs}
          onFocus={() => dispatch(beginEdit())}
          onChange={(e) =>
            dispatch(
              updateEdgeData({
                id: edge.id,
                patch: { latencyMs: Math.max(0, Number(e.target.value) || 0) },
              }),
            )
          }
          className={inputCls}
        />
      </FieldRow>

      <button
        type="button"
        onClick={() => {
          dispatch(snapshot());
          dispatch(deleteSelected());
        }}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-sm border border-danger/50 bg-danger/10 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/20"
      >
        <Trash2 className="size-3.5" />
        Delete Connection
      </button>
    </div>
  );
}
