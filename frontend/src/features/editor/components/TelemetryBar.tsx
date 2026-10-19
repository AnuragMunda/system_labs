"use client";

// Bottom telemetry strip. Shows the active backend run's status/progress and,
// once completed, its aggregate metrics. When idle it falls back to the baseline
// estimates derived from node configs. CPU/Memory are not reported by the
// simulator and render as "—" whenever a run is involved.
import { useAppSelector } from "@/store/hooks";
import type { SimulationRunState } from "@/store/simulationsSlice";
import { computeBaselineTelemetry } from "../telemetry";
import type { ArchitectureTelemetry } from "../types";
import {
  isActiveStatus,
  metricsToTelemetry,
  runProgressPercent,
  statusLabel,
} from "@/features/simulations/mapping";

function formatTraffic(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}K req/s`;
  return `${Math.round(rps)} req/s`;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-sm font-medium ${accent ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function TelemetryBar({ run }: { run?: SimulationRunState }) {
  const nodes = useAppSelector((s) => s.editor.nodes);

  const baseline = computeBaselineTelemetry(nodes);
  const results = run?.results ?? null;
  const active = run ? isActiveStatus(run.status) : false;
  const hasReport = results !== null;
  const live: ArchitectureTelemetry | null = results
    ? metricsToTelemetry(results, nodes)
    : null;

  const statusName = run ? statusLabel(run.status) : "Idle";
  const showActivity = run ? active || hasReport : false;
  const progress = run ? runProgressPercent(run.currentTimeMs, run.durationMs) : 0;

  const unavailable = "—";
  const traffic = live
    ? formatTraffic(live.traffic)
    : active
      ? unavailable
      : formatTraffic(baseline.traffic);
  const p95 = live
    ? `${Math.round(live.p95)}ms`
    : active
      ? unavailable
      : `${baseline.p95}ms`;
  const errorRate = live
    ? live.errorRate
    : active
      ? 0
      : baseline.errorRate;
  const errorText = live
    ? `${(live.errorRate * 100).toFixed(2)}%`
    : active
      ? unavailable
      : `${(baseline.errorRate * 100).toFixed(2)}%`;
  const cpuText = run ? unavailable : `${baseline.cpu}%`;
  const memoryText = run ? unavailable : `${baseline.memory}%`;

  return (
    <footer className="flex h-12 shrink-0 items-center gap-6 overflow-x-auto border-t border-border bg-card px-4">
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${
            showActivity ? "animate-pulse-dot bg-primary" : "bg-muted-foreground"
          }`}
        />
        <span className="text-xs font-medium text-muted-foreground">
          {statusName}
        </span>
      </div>

      {run && active ? (
        <div className="flex items-center gap-2" aria-label="Simulation progress">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {Math.round(progress)}%
          </span>
        </div>
      ) : null}

      <Metric label="Traffic" value={traffic} accent />
      <Metric label="P95" value={p95} />
      <Metric
        label="Errors"
        value={errorText}
        accent={errorRate >= 0.05}
      />
      <Metric label="CPU" value={cpuText} />
      <Metric label="Memory" value={memoryText} />
      <Metric label="Cost" value={`$${Math.round(baseline.cost).toLocaleString()}/mo`} />
    </footer>
  );
}
