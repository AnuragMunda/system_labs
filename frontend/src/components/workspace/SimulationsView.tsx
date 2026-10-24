"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, ChevronRight, Trash2 } from "lucide-react";

import { useWorkspace } from "./workspace-context";
import { useSimulationList } from "@/features/simulations/useSimulationList";
import { DeleteSimulationDialog } from "@/features/simulations/DeleteSimulationDialog";
import { SimulationStatusPill } from "@/features/simulations/SimulationStatusPill";
import {
  isActiveStatus,
  runProgressPercent,
  statusLabel,
} from "@/features/simulations/mapping";
import {
  deleteSimulationApi,
  type SimulationSummary,
} from "@/lib/api/simulations";

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

function buildSimulationSerials(
  items: SimulationSummary[],
): Map<string, number> {
  const groups = new Map<string, SimulationSummary[]>();

  for (const sim of items) {
    const group = groups.get(sim.architectureId);
    if (group) group.push(sim);
    else groups.set(sim.architectureId, [sim]);
  }

  const serials = new Map<string, number>();

  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
      return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
    });

    ordered.forEach((sim, index) => serials.set(sim.id, index + 1));
  }

  return serials;
}

export function SimulationsView() {
  const { projectId, architectures } = useWorkspace();
  const params = useMemo(() => ({ projectId }), [projectId]);
  const { items, loading, error, total, reload } = useSimulationList(params);
  const [deleting, setDeleting] = useState<SimulationSummary | null>(null);
  const serials = useMemo(() => buildSimulationSerials(items), [items]);

  const architectureName = (id: string) =>
    architectures.find((a) => a.id === id)?.name ?? "Architecture";

  const simulationLabel = (sim: SimulationSummary) => {
    const name = architectureName(sim.architectureId);
    const serial = serials.get(sim.id);
    return serial === undefined ? name : `${name} #${serial}`;
  };

  async function handleDelete(sim: SimulationSummary) {
    await deleteSimulationApi(sim.id);
    reload();
  }

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
              serial={serials.get(sim.id)}
              href={`/projects/${projectId}/simulations/${sim.id}`}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      ) : null}

      {deleting ? (
        <DeleteSimulationDialog
          simulation={deleting}
          simulationLabel={simulationLabel(deleting)}
          open
          onClose={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      ) : null}
    </section>
  );
}

function SimulationRow({
  sim,
  architectureName,
  serial,
  href,
  onDelete,
}: {
  sim: SimulationSummary;
  architectureName: string;
  serial?: number;
  href: string;
  onDelete: (sim: SimulationSummary) => void;
}) {
  const progress = runProgressPercent(sim.currentTimeMs, sim.durationMs);

  return (
    <li className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40">
      <Link
        href={href}
        aria-label={`${architectureName}${
          serial === undefined ? "" : ` #${serial}`
        }, ${statusLabel(sim.status)}, ${formatRelative(sim.createdAt)}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-4"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">
            {architectureName}
            {serial === undefined ? null : (
              <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
                #{serial}
              </span>
            )}
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
      {!isActiveStatus(sim.status) ? (
        <button
          type="button"
          onClick={() => onDelete(sim)}
          aria-label={`Delete simulation for ${architectureName}${
            serial === undefined ? "" : ` #${serial}`
          }`}
          aria-haspopup="dialog"
          title="Delete simulation"
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}
