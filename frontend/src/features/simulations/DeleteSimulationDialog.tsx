"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import type { SimulationSummary } from "@/lib/api/simulations";
import { statusLabel } from "./mapping";

function DeleteSimulationModalContent({
  simulation,
  simulationLabel,
  onClose,
  onConfirm,
}: {
  simulation: SimulationSummary;
  simulationLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, pending]);

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to delete simulation.",
      );
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-simulation-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-md border border-border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2
            id="delete-simulation-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            Delete Simulation
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Are you sure you want to delete the{" "}
            <span className="font-medium text-foreground">
              {simulationLabel}
            </span>{" "}
            simulation? Its events and metrics will be permanently deleted. This
            action cannot be undone.
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Status: {statusLabel(simulation.status)}
          </p>
          {error ? (
            <p
              role="alert"
              className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="cursor-pointer rounded-sm border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="cursor-pointer rounded-sm bg-danger px-4 py-2.5 text-sm font-medium text-danger-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteSimulationDialog({
  simulation,
  simulationLabel,
  open,
  onClose,
  onConfirm,
}: {
  simulation: SimulationSummary;
  simulationLabel: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  if (!open) return null;
  return createPortal(
    <DeleteSimulationModalContent
      simulation={simulation}
      simulationLabel={simulationLabel}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
    document.body,
  );
}
