"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ChevronRight } from "lucide-react";

import { useWorkspace } from "./workspace-context";
import { useSimulationList } from "@/features/simulations/useSimulationList";
import { SimulationStatusPill } from "@/features/simulations/SimulationStatusPill";
import {
  isActiveStatus,
  runProgressPercent,
  statusLabel,
} from "@/features/simulations/mapping";
import type { SimulationSummary } from "@/lib/api/simulations";

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SimulationsView() {
  const { projectId, architectures } = useWorkspace();
  const params = useMemo(() => ({ projectId }), [projectId]);
  const { items, loading, error, total } = useSimulationList(params);

  const architectureName = (id: string) =>
    architectures.find((a) => a.id === id)?.name ?? "Architecture";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Simulations</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading runs…"
              : `${total} ${total === 1 ? "run" : "runs"}`}
          </p>
        </div>
        <Link
          href={`/projects/${projectId}/architectures`}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Activity className="size-3.5" />
          Run a new simulation
        </Link>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No simulations yet. Open an architecture, add components, and run a
            simulation to see it here.
          </p>
          <Link
            href={`/projects/${projectId}/architectures`}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Open architectures
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {items.map((sim) => (
            <SimulationRow
              key={sim.id}
              sim={sim}
              architectureName={architectureName(sim.architectureId)}
              href={`/projects/${projectId}/simulations/${sim.id}`}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SimulationRow({
  sim,
  architectureName,
  href,
}: {
  sim: SimulationSummary;
  architectureName: string;
  href: string;
}) {
  const progress = runProgressPercent(sim.currentTimeMs, sim.durationMs);

  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">
            {architectureName}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {statusLabel(sim.status)} · {formatRelative(sim.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isActiveStatus(sim.status) ? (
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          <SimulationStatusPill status={sim.status} />
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </Link>
    </li>
  );
}
