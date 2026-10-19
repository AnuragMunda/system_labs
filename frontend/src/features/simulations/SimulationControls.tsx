"use client";

import { Loader2, Pause, Play, Square } from "lucide-react";

import type { SimulationRunState } from "@/store/simulationsSlice";
import { isTerminalStatus } from "@/lib/api/simulations";
import { SimulationStatusPill } from "./SimulationStatusPill";

interface Props {
  run?: SimulationRunState;
  submitting: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function SimulationControls({
  run,
  submitting,
  onStart,
  onPause,
  onResume,
  onCancel,
}: Props) {
  if (!run || isTerminalStatus(run.status)) {
    return (
      <button
        type="button"
        onClick={onStart}
        disabled={submitting}
        aria-label="Run simulation"
        className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        Run Simulation
      </button>
    );
  }

  const busy = run.pending;

  return (
    <div className="flex items-center gap-2">
      <SimulationStatusPill status={run.status} />
      {busy ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}

      {run.status === "created" ? (
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          aria-label="Start simulation"
          className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="size-3.5" />
          Start
        </button>
      ) : null}

      {run.status === "running" ? (
        <button
          type="button"
          onClick={onPause}
          disabled={busy}
          aria-label="Pause simulation"
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pause className="size-3.5" />
          Pause
        </button>
      ) : null}

      {run.status === "paused" ? (
        <button
          type="button"
          onClick={onResume}
          disabled={busy}
          aria-label="Resume simulation"
          className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="size-3.5" />
          Resume
        </button>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label="Cancel simulation"
        className="inline-flex items-center gap-1.5 rounded-sm border border-danger/50 bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Square className="size-3.5" />
        Cancel
      </button>
    </div>
  );
}
