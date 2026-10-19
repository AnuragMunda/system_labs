"use client";

// RECENT SIMULATIONS section: the project's latest real runs with their backend
// lifecycle status.
import Link from "next/link";
import { useMemo } from "react";

import { useWorkspace } from "./workspace-context";
import { useSimulationList } from "@/features/simulations/useSimulationList";
import { SimulationStatusPill } from "@/features/simulations/SimulationStatusPill";

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

export function RecentSimulations() {
  const { projectId, architectures } = useWorkspace();
  const params = useMemo(() => ({ projectId, limit: 5 }), [projectId]);
  const { items } = useSimulationList(params);

  const architectureName = (id: string) =>
    architectures.find((a) => a.id === id)?.name ?? "Architecture";

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recent Simulations
        </h2>
        <Link
          href={`/projects/${projectId}/simulations`}
          className="text-xs text-primary transition-colors hover:underline"
        >
          View all
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No simulations yet. Open an architecture and run one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((sim) => (
            <li key={sim.id}>
              <Link
                href={`/projects/${projectId}/simulations/${sim.id}`}
                className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-muted/30"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {architectureName(sim.architectureId)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelative(sim.createdAt)}
                  </span>
                </div>
                <SimulationStatusPill status={sim.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
