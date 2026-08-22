"use client";

// The editor canvas: a React Flow surface bound to the Redux editor slice. Handles
// node/edge changes, connections, drag-and-drop from the palette, snapping, and the
// keyboard shortcuts (undo/redo, copy/paste, delete). Renders the custom node/edge
// types, a dotted engineering grid, and a minimap.
import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addNode,
  deleteSelected,
  onConnect,
  onEdgesChange,
  onNodesChange,
  paste,
  copySelection,
  redo,
  setSelection,
  snapshot,
  undo,
} from "@/store/editorSlice";
import { ComponentNode } from "./nodes/ComponentNode";
import { ConnectionEdge } from "./edges/ConnectionEdge";
import {
  DND_MIME,
  MINDMAP_COLORS,
  type ComponentKind,
} from "../constants";
import type { EditorEdge, EditorNode } from "../types";
import type { EdgeTypes, NodeTypes } from "@xyflow/react";

// React Flow's NodeTypes/EdgeTypes index signatures are contravariant on the
// specific node/edge generics, so we cast our tightly-typed renderers.
const nodeTypes = { component: ComponentNode } as unknown as NodeTypes;
const edgeTypes = { connection: ConnectionEdge } as unknown as EdgeTypes;
const SNAP_GRID: [number, number] = [16, 16];

function isEditableTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

export function Canvas({
  onZoomChange,
}: {
  onZoomChange?: (zoom: number) => void;
}) {
  const dispatch = useAppDispatch();
  const nodes = useAppSelector((s) => s.editor.nodes);
  const edges = useAppSelector((s) => s.editor.edges);
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DND_MIME) as ComponentKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      dispatch(addNode({ kind, position }));
    },
    [dispatch, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onSelectionChange = useCallback(
    ({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
      dispatch(
        setSelection({ nodeId: ns[0]?.id ?? null, edgeId: es[0]?.id ?? null }),
      );
    },
    [dispatch],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch(e.shiftKey ? redo() : undo());
      } else if (mod && e.key.toLowerCase() === "c") {
        dispatch(copySelection());
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        dispatch(paste());
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch(snapshot());
        dispatch(deleteSelected());
      }
    };
    const node = wrapper.current;
    node?.addEventListener("keydown", handler);
    return () => node?.removeEventListener("keydown", handler);
  }, [dispatch]);

  return (
    <div ref={wrapper} className="relative h-full w-full outline-none" tabIndex={-1}>
      <ReactFlow<EditorNode, EditorEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(c) => dispatch(onNodesChange(c))}
        onEdgesChange={(c) => dispatch(onEdgesChange(c))}
        onConnect={(c) => dispatch(onConnect(c))}
        onNodeDragStart={() => dispatch(snapshot())}
        onSelectionChange={onSelectionChange}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onMove={(_, viewport) => onZoomChange?.(viewport.zoom)}
        snapToGrid
        snapGrid={SNAP_GRID}
        deleteKeyCode={null}
        minZoom={0.5}
        maxZoom={2.5}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="var(--color-border-strong)"
        />
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border !border-border"
          maskColor="color-mix(in srgb, var(--color-background) 70%, transparent)"
          nodeColor={(n) => {
            const health = (n.data as EditorNode["data"])?.health ?? "healthy";
            return MINDMAP_COLORS[health];
          }}
        />
      </ReactFlow>
    </div>
  );
}
