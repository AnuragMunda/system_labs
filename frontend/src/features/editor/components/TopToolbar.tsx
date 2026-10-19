"use client";

// Editor top toolbar: breadcrumb (project / architecture), inline-editable name,
// undo/redo, zoom controls + fit, simulation controls, Share, Export, and the AI
// panel toggle. Zoom/fit actions use the React Flow instance (must be within a
// ReactFlowProvider); zoom level is passed in from the canvas via the shell.
import {
  Check,
  Download,
  Loader2,
  Maximize2,
  Redo2,
  Share2,
  Sparkles,
  Terminal,
  Undo2,
  ZoomIn,
  ZoomOut,
  ChevronRight,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import Link from "next/link";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { redo, setName, toggleAiPanel, undo } from "@/store/editorSlice";
import type { SimulationRunState } from "@/store/simulationsSlice";
import { SimulationControls } from "@/features/simulations/SimulationControls";
import { useEffect, useRef, useState } from "react";
import { serializeEdge, serializeNode } from "../serialize";
import { toast } from "@/lib/utils";

export function TopToolbar({
  projectName,
  projectId,
  zoom,
  run,
  submitting,
  onStart,
  onPause,
  onResume,
  onCancel,
}: {
  projectName: string;
  projectId: string;
  zoom: number;
  run?: SimulationRunState;
  submitting: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const dispatch = useAppDispatch();
  const name = useAppSelector((s) => s.editor.name);
  const aiOpen = useAppSelector((s) => s.editor.aiPanelOpen);
  const canUndo = useAppSelector((s) => s.editor.past.length > 0);
  const canRedo = useAppSelector((s) => s.editor.future.length > 0);
  const dirty = useAppSelector((s) => s.editor.dirty);
  const saving = useAppSelector((s) => s.editor.saving);
  const lastSavedAt = useAppSelector((s) => s.editor.lastSavedAt);

  // Show the "Saved" confirmation briefly after a successful autosave, then hide it.
  // The state toggles are intentional UI-side effects of the autosave lifecycle.
  /* eslint-disable react-hooks/set-state-in-effect */
  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimer = useRef<number | null>(null);
  useEffect(() => {
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    if (lastSavedAt && !saving && !dirty) {
      setSavedVisible(true);
      savedTimer.current = window.setTimeout(() => setSavedVisible(false), 3000);
    } else {
      setSavedVisible(false);
    }
    return () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    };
  }, [lastSavedAt, saving, dirty]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const nodes = useAppSelector((s) => s.editor.nodes);
  const edges = useAppSelector((s) => s.editor.edges);
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  function handleShare() {
    const href = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(href)
        .then(() => toast("Link copied to clipboard"))
        .catch(() => toast("Could not copy link"));
    } else {
      toast("Link copied to clipboard");
    }
  }

  function handleExport() {
    const payload = {
      name,
      nodes: nodes.map(serializeNode),
      edges: edges.map(serializeEdge),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "architecture"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Architecture exported");
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
      <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label="Breadcrumb">
        <Link
          href="/dashboard"
          aria-label="System Labs dashboard"
          className="flex shrink-0 items-center gap-1.5 pr-1 text-foreground transition-colors hover:text-primary"
        >
          <Terminal className="size-4 text-primary" aria-hidden="true" />
          <span className="hidden font-mono text-sm font-medium tracking-tight text-foreground sm:inline">
            system<span className="text-muted-foreground">_</span>labs
          </span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link
          href={`/projects/${projectId}`}
          className="truncate text-muted-foreground transition-colors hover:text-foreground"
        >
          {projectName}
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          value={name}
          onChange={(e) => dispatch(setName(e.target.value))}
          aria-label="Architecture name"
          className="min-w-0 max-w-[14rem] truncate rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-foreground outline-none transition-colors hover:border-border focus-visible:border-border-strong"
        />
      </nav>

      {saving ? (
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </span>
      ) : savedVisible ? (
        <span className="hidden items-center gap-1.5 text-xs text-success sm:flex" aria-live="polite">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => dispatch(undo())}
          disabled={!canUndo}
          aria-label="Undo"
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => dispatch(redo())}
          disabled={!canRedo}
          aria-label="Redo"
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Redo2 className="size-4" />
        </button>

        <div className="mx-1 h-6 w-px bg-border" />

        <button
          type="button"
          onClick={() => zoomOut({ duration: 150 })}
          aria-label="Zoom out"
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-foreground transition-colors hover:bg-muted"
        >
          <ZoomOut className="size-4" />
        </button>
        <span className="w-12 text-center font-mono text-xs text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomIn({ duration: 150 })}
          aria-label="Zoom in"
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-foreground transition-colors hover:bg-muted"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.2, duration: 200 })}
          aria-label="Fit view"
          className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-foreground transition-colors hover:bg-muted"
        >
          <Maximize2 className="size-4" />
        </button>

        <div className="mx-1 h-6 w-px bg-border" />

        <SimulationControls
          run={run}
          submitting={submitting}
          onStart={onStart}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />

        <div className="mx-1 h-6 w-px bg-border" />

        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Share2 className="size-3.5" />
          Share
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Download className="size-3.5" />
          Export
        </button>
        <button
          type="button"
          onClick={() => dispatch(toggleAiPanel())}
          aria-label="Toggle AI panel"
          aria-pressed={aiOpen}
          className={`inline-flex size-8 items-center justify-center rounded-sm border transition-colors ${
            aiOpen ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted"
          }`}
        >
          <Sparkles className="size-4" />
        </button>
      </div>
    </header>
  );
}
