"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pause, Play, Square } from "lucide-react";

import { useAppDispatch } from "@/store/hooks";
import {
  cancelSimulation,
  pauseSimulation,
  resumeSimulation,
  startSimulation,
} from "@/store/simulationsSlice";
import { useSimulationRun } from "@/features/simulations/useSimulationRun";
import { SimulationStatusPill } from "@/features/simulations/SimulationStatusPill";
import { SimulationMetricsPanel } from "@/features/simulations/SimulationMetricsPanel";
import {
  isActiveStatus,
  runProgressPercent,
  statusLabel,
} from "@/features/simulations/mapping";
import { useWorkspace } from "@/components/workspace/workspace-context";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return date.toLocaleString();
}

export default function SimulationRunPage() {
  const params = useParams();
  const id = String(params.simulationId);
  const dispatch = useAppDispatch();
  const run = useSimulationRun(id);
  const { projectId, architectures } = useWorkspace();

  const architecture = architectures.find((a) => a.id === run?.architectureId);
  const nodeLabels: Record<string, string> = {};
  architecture?.graph.nodes.forEach((node) => {
    nodeLabels[node.id] = node.name;
  });

  if (!run) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Loading simulation…
      </div>
    );
  }

  const progress = runProgressPercent(run.currentTimeMs, run.durationMs);
  const active = isActiveStatus(run.status);
  const busy = run.pending;

  return (
    <section className="flex flex-col gap-6">
      <Link
        href={`/projects/${projectId}/simulations`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All simulations
      </Link>

      <header className="flex flex-col gap-4 rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-foreground">
              {architecture?.name ?? "Simulation"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {statusLabel(run.status)}
            </p>
          </div>
          <SimulationStatusPill status={run.status} />
        </div>

        {active ? (
          <div className="flex items-center gap-3" aria-label="Simulation progress">
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

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Started</p>
            <p className="text-foreground">{formatTime(run.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-foreground">{formatTime(run.completedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="font-mono text-foreground">
              {run.durationMs === null
                ? "—"
                : `${Math.round(run.durationMs / 1000)}s`}
            </p>
          </div>
        </div>

        {run.error ? (
          <p
            role="alert"
            className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {run.error}
          </p>
        ) : null}
        {run.actionError ? (
          <p
            role="alert"
            className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {run.actionError}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          {run.status === "created" ? (
            <button
              type="button"
              onClick={() => dispatch(startSimulation(run.id))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="size-3.5" />
              Start
            </button>
          ) : null}
          {run.status === "running" ? (
            <button
              type="button"
              onClick={() => dispatch(pauseSimulation(run.id))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pause className="size-3.5" />
              Pause
            </button>
          ) : null}
          {run.status === "paused" ? (
            <button
              type="button"
              onClick={() => dispatch(resumeSimulation(run.id))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="size-3.5" />
              Resume
            </button>
          ) : null}
          {active ? (
            <button
              type="button"
              onClick={() => dispatch(cancelSimulation(run.id))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Square className="size-3.5" />
              Cancel
            </button>
          ) : null}
        </div>
      </header>

      <div className="rounded-md border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
          Results
        </h2>
        {run.results ? (
          <SimulationMetricsPanel metrics={run.results} labels={nodeLabels} />
        ) : run.status === "completed" ? (
          <p className="text-sm text-muted-foreground">Fetching results…</p>
        ) : active ? (
          <p className="text-sm text-muted-foreground">
            Metrics are available once the run completes.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No aggregate report is available for this run.
          </p>
        )}
      </div>
    </section>
  );
}
