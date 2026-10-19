"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, X } from "lucide-react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearCreateError } from "@/store/simulationsSlice";
import type { SimulationConfig } from "@/lib/api/simulations";
import { getCatalogLabel } from "@/features/editor/catalog";

interface Props {
  open: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { sourceNodeId: string; config: SimulationConfig }) => void;
}

const inputCls =
  "h-9 w-full rounded-sm border border-border bg-muted px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-border-strong";

// Picks a sensible default traffic source: an explicit client entry, else a node
// with no incoming edges (a natural entry point), else the first node.
function defaultSourceId(
  nodes: { id: string; data: { kind: string } }[],
  incomingTargets: Set<string>,
): string {
  const client = nodes.find((n) => n.data.kind === "client");
  if (client) return client.id;
  const entry = nodes.find((n) => !incomingTargets.has(n.id));
  return entry?.id ?? nodes[0]?.id ?? "";
}

export function SimulationConfigDialog({
  open,
  submitting,
  error,
  onClose,
  onSubmit,
}: Props) {
  const dispatch = useAppDispatch();
  const nodes = useAppSelector((s) => s.editor.nodes);
  const edges = useAppSelector((s) => s.editor.edges);

  const incomingTargets = useMemo(
    () => new Set(edges.map((e) => e.target)),
    [edges],
  );

  const [durationSeconds, setDurationSeconds] = useState("60");
  const [requestsPerSecond, setRequestsPerSecond] = useState("100");
  const [randomSeed, setRandomSeed] = useState("");
  const [sourceOverride, setSourceOverride] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const sourceNodeId =
    sourceOverride ?? defaultSourceId(nodes, incomingTargets);

  useEffect(() => {
    if (open) dispatch(clearCreateError());
  }, [open, dispatch]);

  if (!open) return null;

  const noNodes = nodes.length === 0;

  function handleClose() {
    setSourceOverride(null);
    setValidationError(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const duration = Number(durationSeconds);
    const rps = Number(requestsPerSecond);

    if (!Number.isFinite(duration) || duration <= 0) {
      setValidationError("Duration must be a positive number of seconds.");
      return;
    }
    if (!Number.isFinite(rps) || rps < 0) {
      setValidationError("Requests per second must be zero or greater.");
      return;
    }
    if (!sourceNodeId) {
      setValidationError("Select a traffic source.");
      return;
    }
    const seed = randomSeed.trim();
    if (seed !== "" && !Number.isInteger(Number(seed))) {
      setValidationError("Seed must be a whole number.");
      return;
    }

    setValidationError(null);
    const config: SimulationConfig = {
      durationMs: Math.round(duration * 1000),
      requestsPerSecond: rps,
      collectMetrics: true,
      emitEvents: true,
    };
    if (seed !== "") config.randomSeed = Number(seed);
    onSubmit({ sourceNodeId, config });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Run simulation"
    >
      <div className="w-full max-w-md rounded-md border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Run simulation
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
          {noNodes ? (
            <p className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              Add at least one component to the canvas before running a
              simulation.
            </p>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Traffic source
            </span>
            <select
              value={sourceNodeId}
              onChange={(e) => setSourceOverride(e.target.value)}
              className={inputCls}
              disabled={noNodes}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.data.label} ({getCatalogLabel(n.data.kind)})
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Duration (s)
              </span>
              <input
                type="number"
                min={1}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Requests / s
              </span>
              <input
                type="number"
                min={0}
                value={requestsPerSecond}
                onChange={(e) => setRequestsPerSecond(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Random seed (optional)
            </span>
            <input
              type="number"
              value={randomSeed}
              placeholder="Deterministic when provided"
              onChange={(e) => setRandomSeed(e.target.value)}
              className={inputCls}
            />
          </label>

          {validationError ?? error ? (
            <p className="text-xs text-danger" role="alert">
              {validationError ?? error}
            </p>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The architecture is saved as the run snapshot, then executed on the
            backend. Progress is polled while it runs; detailed metrics appear
            when it completes.
          </p>

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || noNodes}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              Save &amp; run
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
