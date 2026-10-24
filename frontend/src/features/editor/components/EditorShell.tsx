"use client";

// Editor shell: lays out the toolbar, left palette, canvas (~70%), right inspector
// and AI panel, and the bottom telemetry bar. Hosts the ReactFlowProvider so the
// toolbar can drive zoom/fit. Owns the backend simulation run (create → start →
// poll) and the debounced autosave of the architecture graph.
import { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { store } from "@/store";
import {
  applySimulationMetrics,
  clearSimulationMetrics,
  initEditor,
  markSaved,
  setSaving,
} from "@/store/editorSlice";
import {
  createSimulation,
  pauseSimulation,
  resumeSimulation,
  startSimulation,
  cancelSimulation,
} from "@/store/simulationsSlice";
import { useSimulationRun } from "@/features/simulations/useSimulationRun";
import {
  metricsToNodeHealth,
  metricsToNodeLive,
  isActiveStatus,
} from "@/features/simulations/mapping";
import { SimulationConfigDialog } from "@/features/simulations/SimulationConfigDialog";
import { listSimulationsApi, type SimulationConfig } from "@/lib/api/simulations";
import { updateArchitectureApi } from "@/lib/api/architectures";
import { toast } from "@/lib/utils";
import { deserializeEdge, deserializeNode, serializeEdge, serializeNode } from "../serialize";
import { TopToolbar } from "./TopToolbar";
import { ComponentPalette } from "./ComponentPalette";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { AIPanel } from "./AIPanel";
import { TelemetryDrawer } from "./TelemetryBar";
import type { BackendArchitecture } from "@/lib/api/architectures";

export function EditorShell({
  architecture,
  projectName,
}: {
  architecture: BackendArchitecture;
  projectName: string;
}) {
  const dispatch = useAppDispatch();
  const [zoom, setZoom] = useState(1);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const run = useSimulationRun(activeId);
  const metricsSource = run?.results ?? run?.liveMetrics;
  const running = run?.status === "running";
  const dirty = useAppSelector((s) => s.editor.dirty);
  const name = useAppSelector((s) => s.editor.name);
  const submitting = useAppSelector((s) => s.simulations.submitting);
  const createError = useAppSelector((s) => s.simulations.createError);

  useEffect(() => {
    dispatch(
      initEditor({
        architectureId: architecture.id,
        projectId: architecture.projectId,
        name: architecture.name,
        description: architecture.description,
        nodes: architecture.graph.nodes.map(deserializeNode),
        edges: architecture.graph.edges.map(deserializeEdge),
      }),
    );
  }, [architecture, dispatch]);

  // Re-attach to an existing run for this architecture (e.g. after a reload).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const page = await listSimulationsApi({
          architectureId: architecture.id,
          saved: false,
          limit: 10,
        });
        const active =
          page.items.find((item) => isActiveStatus(item.status)) ??
          page.items.find((item) => item.status === "completed");
        if (!cancelled && active) setActiveId(active.id);
      } catch {
        // Unauthenticated or none yet; the editor starts idle.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [architecture.id]);

  // Reset overlays whenever the active run changes (baseline until results).
  useEffect(() => {
    dispatch(clearSimulationMetrics());
  }, [activeId, dispatch]);

  // Overlay the current run's per-node metrics and health onto the canvas. While
  // running we use the live snapshot (polled each second); once the aggregate
  // report arrives it takes precedence. `running` gates the edge flow animation,
  // and is enough on its own so source edges start flowing before the first poll.
  useEffect(() => {
    if (!metricsSource && !running) return;
    dispatch(
      applySimulationMetrics({
        nodeMetrics: metricsSource ? metricsToNodeLive(metricsSource) : {},
        nodeHealth: metricsSource ? metricsToNodeHealth(metricsSource) : {},
        running,
      }),
    );
  }, [metricsSource, running, dispatch]);

  const flushSave = useCallback(async () => {
    const { name: currentName, nodes, edges } = store.getState().editor;
    dispatch(setSaving(true));
    await updateArchitectureApi(architecture.id, {
      name: currentName,
      nodes: nodes.map(serializeNode),
      edges: edges.map(serializeEdge),
    });
    dispatch(markSaved(new Date().toISOString()));
  }, [architecture.id, dispatch]);

  // Debounced autosave whenever the graph is dirty.
  useEffect(() => {
    if (!dirty || !architecture.id) return;
    const handle = window.setTimeout(async () => {
      const { name: currentName, nodes, edges } = store.getState().editor;
      dispatch(setSaving(true));
      try {
        await updateArchitectureApi(architecture.id, {
          name: currentName,
          nodes: nodes.map(serializeNode),
          edges: edges.map(serializeEdge),
        });
        dispatch(markSaved(new Date().toISOString()));
      } catch {
        dispatch(setSaving(false));
        toast("Failed to save architecture");
      }
    }, 2000);
    return () => window.clearTimeout(handle);
  }, [dirty, architecture.id, name, dispatch]);

  const handleStart = useCallback(() => {
    if (run && run.status === "created") {
      dispatch(startSimulation(run.id));
      return;
    }
    setDialogOpen(true);
  }, [run, dispatch]);

  const handlePause = useCallback(() => {
    if (activeId) dispatch(pauseSimulation(activeId));
  }, [activeId, dispatch]);

  const handleResume = useCallback(() => {
    if (activeId) dispatch(resumeSimulation(activeId));
  }, [activeId, dispatch]);

  const handleCancel = useCallback(() => {
    if (activeId) dispatch(cancelSimulation(activeId));
  }, [activeId, dispatch]);

  const handleRemoved = useCallback(() => {
    setActiveId(null);
    toast("Simulation removed");
  }, []);

  const handleRun = useCallback(
    async (input: { sourceNodeId: string; config: SimulationConfig }) => {
      try {
        await flushSave();
      } catch {
        toast("Failed to save architecture");
        return;
      }
      try {
        const created = await dispatch(
          createSimulation({
            architectureId: architecture.id,
            sourceNodeId: input.sourceNodeId,
            config: input.config,
          }),
        ).unwrap();
        dispatch(startSimulation(created.id));
        setActiveId(created.id);
        setDialogOpen(false);
      } catch {
        // createError is rendered inside the dialog by the slice.
      }
    },
    [architecture.id, dispatch, flushSave],
  );

  return (
    <ReactFlowProvider>
      <div className="editor-root flex h-full flex-col">
        <TopToolbar
          projectName={projectName}
          projectId={architecture.projectId}
          zoom={zoom}
          run={run}
          submitting={submitting}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
        />
        <div className="flex min-h-0 flex-1">
          <ComponentPalette
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed((c) => !c)}
          />
          <div className="min-w-0 flex-1">
            <Canvas onZoomChange={setZoom} />
          </div>
          <Inspector
            collapsed={inspectorCollapsed}
            onToggle={() => setInspectorCollapsed((c) => !c)}
          />
          <AIPanel />
        </div>
        <TelemetryDrawer run={run} onRemoved={handleRemoved} />
      </div>

      <SimulationConfigDialog
        open={dialogOpen}
        submitting={submitting}
        error={createError}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleRun}
      />
    </ReactFlowProvider>
  );
}
