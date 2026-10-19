import { describe, expect, it } from "vitest";

import reducer, {
  applySimulationMetrics,
  clearSimulationMetrics,
  initEditor,
} from "./editorSlice";
import { createNode } from "@/features/editor/serialize";
import type { EditorEdge } from "@/features/editor/types";

const nodeLive = {
  rps: 25,
  p50: 1,
  p95: 4,
  p99: 8,
  errorRate: 0.02,
  queueDepth: 3,
};

/** Seeds the editor with client `n1` → api `n2` → db `n3`. */
function seeded() {
  const source = { ...createNode("client", { x: 0, y: 0 }), id: "n1" };
  const api = { ...createNode("api", { x: 100, y: 0 }), id: "n2" };
  const db = { ...createNode("database", { x: 200, y: 0 }), id: "n3" };
  const edges: EditorEdge[] = [
    {
      id: "e1",
      type: "connection",
      source: "n1",
      target: "n2",
      data: { protocol: "http", trafficRate: 10, latencyMs: 5 },
    },
    {
      id: "e2",
      type: "connection",
      source: "n2",
      target: "n3",
      data: { protocol: "sql", trafficRate: 10, latencyMs: 5 },
    },
  ];

  return reducer(
    undefined,
    initEditor({
      architectureId: "arch-1",
      projectId: "proj-1",
      name: "System",
      description: null,
      nodes: [source, api, db],
      edges,
    }),
  );
}

describe("applySimulationMetrics", () => {
  it("overlays node metrics/health and derives edge flow from either endpoint", () => {
    const state = reducer(
      seeded(),
      applySimulationMetrics({
        nodeMetrics: {
          n1: { ...nodeLive, rps: 0 },
          n2: { ...nodeLive, rps: 30 },
        },
        nodeHealth: { n1: "degraded", n2: "healthy" },
        running: true,
      }),
    );

    const source = state.nodes.find((n) => n.id === "n1");
    expect(source?.data.live).toEqual({ ...nodeLive, rps: 0 });
    expect(source?.data.health).toBe("degraded");

    const edge = state.edges.find((e) => e.id === "e1");
    expect(edge?.data).toMatchObject({
      live: { rps: 30, latency: nodeLive.p95, errors: nodeLive.errorRate },
      flowing: true,
    });
  });

  it("flows out of the traffic source even when it reports no throughput", () => {
    const state = reducer(
      seeded(),
      applySimulationMetrics({
        nodeMetrics: { n1: { ...nodeLive, rps: 0 } },
        nodeHealth: {},
        running: true,
      }),
    );

    const sourceEdge = state.edges.find((e) => e.id === "e1");
    expect(sourceEdge?.data?.flowing).toBe(true);
    expect(sourceEdge?.data?.live?.rps).toBe(0);
  });

  it("flows when either endpoint has queued work", () => {
    const state = reducer(
      seeded(),
      applySimulationMetrics({
        nodeMetrics: { n2: { ...nodeLive, rps: 0, queueDepth: 7 } },
        nodeHealth: {},
        running: true,
      }),
    );

    const nonRootEdge = state.edges.find((e) => e.id === "e2");
    expect(nonRootEdge?.data?.flowing).toBe(true);
  });

  it("does not flow on an idle non-root edge", () => {
    const state = reducer(
      seeded(),
      applySimulationMetrics({
        nodeMetrics: {
          n1: { ...nodeLive, rps: 0 },
          n2: { ...nodeLive, rps: 0, queueDepth: 0 },
        },
        nodeHealth: {},
        running: true,
      }),
    );

    const nonRootEdge = state.edges.find((e) => e.id === "e2");
    expect(nonRootEdge?.data?.flowing).toBe(false);
  });

  it("stops all flow when the run is not running", () => {
    const state = reducer(
      seeded(),
      applySimulationMetrics({
        nodeMetrics: { n2: { ...nodeLive, rps: 30 } },
        nodeHealth: {},
        running: false,
      }),
    );

    expect(state.edges.every((e) => e.data?.flowing === false)).toBe(true);
  });
});

describe("clearSimulationMetrics", () => {
  it("removes node and edge overlays", () => {
    const applied = reducer(
      seeded(),
      applySimulationMetrics({
        nodeMetrics: { n1: nodeLive },
        nodeHealth: { n1: "critical" },
        running: true,
      }),
    );

    const cleared = reducer(applied, clearSimulationMetrics());

    expect(cleared.nodes[0].data.live).toBeUndefined();
    expect(cleared.nodes[0].data.health).toBe("healthy");
    expect(cleared.edges[0].data?.live).toBeUndefined();
    expect(cleared.edges[0].data?.flowing).toBe(false);
  });
});
