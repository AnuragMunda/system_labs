/**
 * @file capacity-invariants.test.ts
 *
 * @description Guards the engine's capacity invariants: a run never starts with
 * `replicas` outside the configured autoscaling band, `setComponentReplicas`
 * never drops effective concurrency below the requests already in flight, and
 * `activeRequests` stays within `[0, effectiveConcurrency]` for every component
 * across a full run. Cache hits are the explicit exception: they complete
 * without ever entering normal processing capacity.
 */

import { describe, expect, it } from "vitest";

import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { createEvent } from "@/simulation-engine/utils/helpers.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";

const SIMULATION_ID = "simulation-1";

function node(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
): ArchitectureGraph["nodes"][number] {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function createSimulation(graph: ArchitectureGraph): Simulation {
  return {
    id: SIMULATION_ID,
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    currentTimeMs: 0,
    seed: 42,
    architectureSnapshot: graph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createHarness(graph: ArchitectureGraph) {
  const runtime = new SimulationRuntime(createSimulation(graph));
  const processor = new DefaultEventProcessor(
    runtime,
    new AutoscalingController(runtime),
    new AutoscalingScheduler(runtime),
  );
  const engine = new SimulationEngine(runtime, processor);

  return { runtime, processor, engine };
}

describe("initial replicas clamp into the autoscaling band", () => {
  it("starts at the autoscaling minimum when replicas is omitted", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          concurrency: 2,
          autoscaling: { enabled: true, min: 3, max: 6, targetCpu: 70 },
        }),
      ],
      edges: [],
    };

    const { runtime } = createHarness(graph);

    expect(runtime.getComponent("api").replicas).toBe(3);
    expect(runtime.getComponent("api").effectiveConcurrency).toBe(6);
  });

  it("starts at the autoscaling maximum when replicas exceeds the band", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          replicas: 10,
          concurrency: 2,
          autoscaling: { enabled: true, min: 3, max: 6, targetCpu: 70 },
        }),
      ],
      edges: [],
    };

    const { runtime } = createHarness(graph);

    expect(runtime.getComponent("api").replicas).toBe(6);
    expect(runtime.getComponent("api").effectiveConcurrency).toBe(12);
  });

  it("leaves replicas untouched when autoscaling is disabled", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          replicas: 2,
          concurrency: 1,
          autoscaling: { enabled: false, min: 5, max: 8, targetCpu: 70 },
        }),
      ],
      edges: [],
    };

    const { runtime } = createHarness(graph);

    expect(runtime.getComponent("api").replicas).toBe(2);
    expect(runtime.getComponent("api").effectiveConcurrency).toBe(2);
  });
});

describe("setComponentReplicas never drops capacity below active requests", () => {
  const graph: ArchitectureGraph = {
    nodes: [node("api", "api", { replicas: 3, concurrency: 2 })],
    edges: [],
  };

  it("rejects a scale-down whose effective concurrency would fall below active requests", () => {
    const { runtime } = createHarness(graph);

    for (let index = 0; index < 5; index += 1) {
      runtime.incrementActiveRequests("api");
    }

    expect(runtime.getActiveRequestCount("api")).toBe(5);
    expect(runtime.getComponent("api").effectiveConcurrency).toBe(6);

    // 2 replicas x 2 concurrency = 4 slots, below the 5 in-flight requests.
    expect(() => runtime.setComponentReplicas("api", 2)).toThrow(
      /below the 5 active requests/,
    );

    // The rejected call left the component unchanged.
    expect(runtime.getComponent("api").replicas).toBe(3);
    expect(runtime.getComponent("api").effectiveConcurrency).toBe(6);
  });

  it("allows a scale-down once enough capacity is free", () => {
    const { runtime } = createHarness(graph);

    for (let index = 0; index < 4; index += 1) {
      runtime.incrementActiveRequests("api");
    }

    runtime.setComponentReplicas("api", 2);

    expect(runtime.getComponent("api").replicas).toBe(2);
    expect(runtime.getComponent("api").effectiveConcurrency).toBe(4);
  });

  it("allows a scale-up regardless of active requests", () => {
    const { runtime } = createHarness(graph);

    for (let index = 0; index < 6; index += 1) {
      runtime.incrementActiveRequests("api");
    }

    runtime.setComponentReplicas("api", 5);

    expect(runtime.getComponent("api").effectiveConcurrency).toBe(10);
  });
});

describe("capacity invariants hold across a full run", () => {
  function assertInvariants(
    runtime: SimulationRuntime,
    graph: ArchitectureGraph,
  ): void {
    for (const definition of graph.nodes) {
      const component = runtime.getComponent(definition.id);
      const active = runtime.getActiveRequestCount(definition.id);
      const queued = runtime.getQueuedRequestCount(definition.id);
      const autoscaling = definition.config.autoscaling;

      expect(active).toBeGreaterThanOrEqual(0);
      expect(queued).toBeGreaterThanOrEqual(0);
      expect(active).toBeLessThanOrEqual(component.effectiveConcurrency);

      if (autoscaling?.enabled) {
        expect(component.replicas).toBeGreaterThanOrEqual(autoscaling.min);
        expect(component.replicas).toBeLessThanOrEqual(autoscaling.max);
      }
    }
  }

  it("keeps every component within capacity while processing arrivals", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", {
          replicas: 1,
          concurrency: 2,
          latencyMs: 5,
          queue: { enabled: true, maxSize: 10 },
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, engine } = createHarness(graph);

    for (let index = 0; index < 6; index += 1) {
      const requestId = `req-${index}`;

      runtime.createRequest({
        id: requestId,
        status: "pending",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "client",
      });

      runtime.schedule(
        createEvent({
          simulationId: SIMULATION_ID,
          timestampMs: index,
          type: "request.created",
          sourceNodeId: "client",
          payload: { requestId },
        }),
      );
    }

    engine.start();
    assertInvariants(runtime, graph);

    while (engine.hasPendingEvents()) {
      engine.step();
      assertInvariants(runtime, graph);
    }

    // Nothing leaked: all capacity is returned and no work is stranded.
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });
});

describe("cache hits bypass processing capacity", () => {
  function cacheGraph(config: Record<string, unknown> = {}): ArchitectureGraph {
    return {
      nodes: [
        node("client", "client"),
        node("cache", "cache", {
          cache: { ttlMs: 1000, capacity: 4 },
          replicas: 1,
          concurrency: 1,
          latencyMs: 0,
          healthThresholds: {
            utilization: { degraded: 2, critical: 3 },
            errorRate: { degraded: 2, critical: 3 },
            latencyMs: { degraded: 1_000_000, critical: 2_000_000 },
          },
          ...config,
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "cache", config: {} }],
    };
  }

  function createCacheRequest(
    runtime: SimulationRuntime,
    requestId: string,
    cacheKey: string,
  ): void {
    runtime.createRequest({
      id: requestId,
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
      cacheKey,
    });
  }

  function routeToCache(
    processor: DefaultEventProcessor,
    requestId: string,
    timestampMs = 10,
  ): void {
    processor.process(
      createEvent({
        simulationId: SIMULATION_ID,
        timestampMs,
        type: "request.routed",
        sourceNodeId: "client",
        targetNodeId: "cache",
        payload: { requestId },
      }),
    );
  }

  function dequeueEventOfType(
    runtime: SimulationRuntime,
    type: string,
  ): ReturnType<typeof runtime.eventQueue.dequeue> {
    while (!runtime.eventQueue.isEmpty()) {
      const event = runtime.eventQueue.dequeue();

      if (event?.type === type) {
        return event;
      }
    }

    return undefined;
  }

  it("completes a hit without touching activeRequests or effectiveConcurrency", () => {
    const { runtime, processor } = createHarness(cacheGraph());

    const effectiveBefore = runtime.getComponent("cache").effectiveConcurrency;

    runtime.setCacheEntry("cache", "GET:/users/123", { requestId: "seed" });
    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1");

    const hit = dequeueEventOfType(runtime, "cache.hit")!;
    processor.process(hit);

    // The hit schedules only the completion — no processing pass.
    const scheduled = dequeueEventOfType(runtime, "request.completed")!;

    expect(runtime.getActiveRequestCount("cache")).toBe(0);
    expect(runtime.getComponent("cache").effectiveConcurrency).toBe(
      effectiveBefore,
    );

    processor.process(scheduled);

    expect(runtime.getRequest("req-1").status).toBe("completed");
    expect(runtime.getActiveRequestCount("cache")).toBe(0);
  });

  it("consumes and releases capacity on the miss path", () => {
    const { runtime, processor } = createHarness(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1");

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);

    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);

    expect(runtime.getActiveRequestCount("cache")).toBe(1);

    const completed = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    )!;
    processor.process(completed);

    expect(runtime.getActiveRequestCount("cache")).toBe(0);
  });
});
