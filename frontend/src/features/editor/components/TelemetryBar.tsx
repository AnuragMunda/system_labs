"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
  Trash2,
} from "lucide-react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  removeSimulation,
  saveSimulation,
  type SimulationRunState,
} from "@/store/simulationsSlice";
import { SimulationMetricsPanel } from "@/features/simulations/SimulationMetricsPanel";
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

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
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

export function TelemetryDrawer({
  run,
  onRemoved,
}: {
  run?: SimulationRunState;
  onRemoved: () => void;
}) {
  const dispatch = useAppDispatch();
  const nodes = useAppSelector((s) => s.editor.nodes);
  const [expanded, setExpanded] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const previousRunId = useRef<string | undefined>(undefined);
  const previousStatus = useRef(run?.status);
  const dismissed = useRef(false);

  const baseline = computeBaselineTelemetry(nodes);
  const results = run?.results ?? null;
  const active = run ? isActiveStatus(run.status) : false;
  const hasReport = results !== null;
  const live: ArchitectureTelemetry | null = results
    ? metricsToTelemetry(results, nodes)
    : null;

  const statusName = run ? statusLabel(run.status) : "Idle";
  const showActivity = run ? active || hasReport : false;
  const progress = run
    ? runProgressPercent(run.currentTimeMs, run.durationMs)
    : 0;

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
  const errorRate = live ? live.errorRate : active ? 0 : baseline.errorRate;
  const errorText = live
    ? `${(live.errorRate * 100).toFixed(2)}%`
    : active
      ? unavailable
      : `${(baseline.errorRate * 100).toFixed(2)}%`;
  const cpuText = run ? unavailable : `${baseline.cpu}%`;
  const memoryText = run ? unavailable : `${baseline.memory}%`;

  useEffect(() => {
    const runId = run?.id;
    const status = run?.status;

    if (previousRunId.current !== runId) {
      previousRunId.current = runId;
      previousStatus.current = status;
      dismissed.current = false;
      setExpanded(false);
      setConfirmRemove(false);
      return;
    }

    if (
      status === "completed" &&
      previousStatus.current !== "completed" &&
      !dismissed.current
    ) {
      setExpanded(true);
    }
    previousStatus.current = status;
  }, [run?.id, run?.status]);

  function collapse() {
    dismissed.current = true;
    setExpanded(false);
    setConfirmRemove(false);
  }

  function toggle() {
    if (expanded) {
      collapse();
      return;
    }
    setExpanded(true);
  }

  async function handleSave() {
    if (!run) return;
    const result = await dispatch(saveSimulation(run.id));
    if (saveSimulation.fulfilled.match(result)) {
      setExpanded(true);
    }
  }

  async function handleRemove() {
    if (!run) return;
    const result = await dispatch(removeSimulation(run.id));
    if (removeSimulation.fulfilled.match(result)) {
      setConfirmRemove(false);
      onRemoved();
    }
  }

  const canSave = run?.status === "completed" && !run.savedAt;
  const canRemove = Boolean(run?.savedAt);
  const labels = Object.fromEntries(
    nodes.map((node) => [node.id, node.data.label]),
  );

  return (
    <div className="relative z-30 shrink-0 border-t border-border bg-card">
      {expanded ? (
        <section
          id="telemetry-details"
          aria-label="Simulation details"
          className="absolute inset-x-0 bottom-full max-h-[65vh] overflow-y-auto border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
        >
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    Run details
                  </h2>
                  {run?.savedAt ? (
                    <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Saved
                    </span>
                  ) : run ? (
                    <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                      Draft
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {run
                    ? `${statusName}${
                        run.startedAt
                          ? ` · started ${new Date(run.startedAt).toLocaleTimeString()}`
                          : ""
                      }`
                    : "No active run. Start a simulation to see detailed metrics."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canSave ? (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={run?.pending}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {run?.pending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save simulation
                  </button>
                ) : null}

                {canRemove ? (
                  confirmRemove ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Remove permanently?
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(false)}
                        className="rounded-sm border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleRemove}
                        disabled={run?.pending}
                        className="inline-flex items-center gap-1.5 rounded-sm bg-danger px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {run?.pending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        Remove run
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(true)}
                      disabled={run?.pending}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-danger/50 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </button>
                  )
                ) : null}

                <button
                  type="button"
                  onClick={collapse}
                  aria-label="Collapse details"
                  className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
            </div>

            {run?.actionError ? (
              <p role="alert" className="text-xs text-danger">
                {run.actionError}
              </p>
            ) : null}

            {run && active ? (
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
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

            {results ? (
              <SimulationMetricsPanel metrics={results} labels={labels} />
            ) : (
              <p className="rounded-sm border border-border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
                {run?.status === "completed"
                  ? "Loading the aggregate report…"
                  : run?.status === "failed"
                    ? (run.error ?? "The run failed before producing metrics.")
                    : active
                      ? "Detailed metrics appear when the run completes."
                      : "No metrics recorded for this run."}
              </p>
            )}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls="telemetry-details"
        aria-label="Toggle simulation details"
        className="flex h-12 w-full items-center gap-6 overflow-x-auto px-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex shrink-0 items-center gap-2">
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
          <div
            className="flex shrink-0 items-center gap-2"
            aria-label="Simulation progress"
          >
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
        <Metric label="Errors" value={errorText} accent={errorRate >= 0.05} />
        <Metric label="CPU" value={cpuText} />
        <Metric label="Memory" value={memoryText} />
        <Metric
          label="Cost"
          value={`$${Math.round(baseline.cost).toLocaleString()}/mo`}
        />

        {run && !run.savedAt ? (
          <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-accent">
            Draft
          </span>
        ) : null}
        <span
          className={`${run && !run.savedAt ? "" : "ml-auto"} inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground`}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </span>
      </button>
    </div>
  );
}
