/**
 * @file metrics-snapshot.test.ts
 *
 * @description Tests for the simulation metrics snapshot: the bounded latency
 * histogram primitive, the pure snapshot builder, and the runtime's end-to-end
 * metrics recording through full engine runs.
 */

import { describe, expect, it } from "vitest";

import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationSession } from "@/simulation-engine/core/simulation-session.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import {
  LatencyHistogram,
  roundLatency,
} from "@/simulation-engine/metrics/latency-histogram.js";
import type { Simulation } from "@/domain/simulation/simulation.types.js";
import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type { ArchitectureNode } from "@/domain/architecture/component.types.js";
import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import type { SimulationMetrics } from "@/domain/simulation/metrics.types.js";

function node(
  id: string,
  type: string,
  config: ArchitectureNode["config"] = {},
): ArchitectureNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function edge(
  source: string,
  target: string,
  config: NonNullable<ArchitectureGraph["edges"]>[number]["config"] = {},
) {
  return { id: `${source}-${target}`, source, target, config };
}

function createSimulation(
  graph: ArchitectureGraph,
  overrides: {
    durationMs?: number;
    requestsPerSecond?: number;
    seed?: number;
    collectMetrics?: boolean;
    cacheKeys?: string[];
    databaseOperations?: ("read" | "write")[];
  } = {},
): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: overrides.durationMs ?? 1000,
      requestsPerSecond: overrides.requestsPerSecond ?? 10,
      simulationSpeed: 1,
      collectMetrics: overrides.collectMetrics ?? true,
      emitEvents: true,
      cacheKeys: overrides.cacheKeys,
      databaseOperations: overrides.databaseOperations,
    },
    currentTimeMs: 0,
    seed: overrides.seed ?? 42,
    architectureSnapshot: graph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createFixture(
  graph: ArchitectureGraph,
  overrides: Parameters<typeof createSimulation>[1] = {},
) {
  const simulation = createSimulation(graph, overrides);
  const runtime = new SimulationRuntime(simulation);
  const controller = new AutoscalingController(runtime);
  const scheduler = new AutoscalingScheduler(runtime);
  const processor = new DefaultEventProcessor(runtime, controller, scheduler);
  const engine = new SimulationEngine(runtime, processor);
  const session = new SimulationSession(
    runtime,
    engine,
    new TrafficGenerator(runtime),
    new FailureScheduler(runtime),
    scheduler,
  );

  return {
    simulation,
    runtime,
    controller,
    processor,
    scheduler,
    engine,
    session,
  };
}

/** Runs a complete engine loop (load + failures + autoscaling + execution). */
function runToEnd(session: SimulationSession, entryNodeId: string): void {
  session.run(entryNodeId);
}

/** Builds a two-hop client → api → db graph with healthy, responsive nodes. */
function buildPipelineGraph(): ArchitectureGraph {
  return {
    nodes: [
      node("client", "load_balancer"),
      node("api", "api", { concurrency: 100, latencyMs: 20 }),
      node("db", "database", { concurrency: 100, latencyMs: 30 }),
    ],
    edges: [
      edge("client", "api", { latencyMs: 0 }),
      edge("api", "db", { latencyMs: 0 }),
    ],
  };
}

function evaluateEvent(nodeId: string, timestampMs: number): SimulationEvent {
  return {
    id: `event-eval-${nodeId}-${timestampMs}`,
    simulationId: "simulation-1",
    timestampMs,
    type: "autoscaling.evaluate",
    sourceNodeId: nodeId,
  };
}

function scaledEvent(
  nodeId: string,
  timestampMs: number,
  replicas: number,
): SimulationEvent {
  return {
    id: `event-scaled-${nodeId}-${timestampMs}`,
    simulationId: "simulation-1",
    timestampMs,
    type: "component.scaled",
    sourceNodeId: nodeId,
    payload: {
      previousReplicas: replicas - 1,
      replicas,
      utilization: 100,
      targetCpu: 50,
      reason: "cpu_target",
    },
  };
}

describe("LatencyHistogram", () => {
  it("returns a zero-safe summary when no samples were recorded", () => {
    const histogram = new LatencyHistogram();

    expect(histogram.summary()).toEqual({
      count: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    });
  });

  it("computes exact aggregates and bounded percentiles from samples", () => {
    const histogram = new LatencyHistogram();

    for (let i = 0; i < 100; i++) histogram.record(50);

    const summary = histogram.summary();

    expect(summary.count).toBe(100);
    expect(summary.avgMs).toBe(50);
    expect(summary.minMs).toBe(50);
    expect(summary.maxMs).toBe(50);
    expect(summary.p50Ms).toBeGreaterThanOrEqual(50);
    expect(summary.p95Ms).toBeGreaterThanOrEqual(50);
    expect(summary.p99Ms).toBeGreaterThanOrEqual(50);
  });

  it("is deterministic and rounding quantizes latency", () => {
    const first = new LatencyHistogram();
    const second = new LatencyHistogram();

    for (const sample of [1.5, 2.25, 3.75]) {
      first.record(sample);
      second.record(sample);
    }

    expect(first.summary()).toEqual(second.summary());
    expect(roundLatency(1.005)).toBe(1.005);
  });

  it("merges two histograms into one summary", () => {
    const first = new LatencyHistogram();
    const second = new LatencyHistogram();

    first.record(10);
    second.record(30);

    first.merge(second);

    const summary = first.summary();

    expect(summary.count).toBe(2);
    expect(summary.avgMs).toBe(20);
    expect(summary.minMs).toBe(10);
    expect(summary.maxMs).toBe(30);
  });
});

describe("SimulationMetrics", () => {
  it("returns a zero-safe snapshot for an empty simulation", () => {
    const graph = buildPipelineGraph();
    const { runtime, session } = createFixture(graph, { requestsPerSecond: 0 });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.collectMetrics).toBe(true);
    // No events fired, so the virtual clock never advanced.
    expect(metrics.processedDurationMs).toBe(0);
    expect(metrics.processedDurationMs).toBeLessThanOrEqual(metrics.durationMs);

    expect(metrics.requests).toMatchObject({
      generated: 0,
      completed: 0,
      failed: 0,
      retries: 0,
      successRate: 0,
      errorRate: 0,
      inFlight: 0,
      queued: 0,
      failedByReason: {},
    });

    expect(metrics.failures).toEqual({ total: 0, byReason: {}, byNode: {} });
    expect(metrics.network).toMatchObject({
      transmissions: 0,
      packetLosses: 0,
      packetLossRate: 0,
      totalLatencyMs: 0,
    });
    expect(metrics.latency.processing.totals.count).toBe(0);
    expect(metrics.latency.endToEnd).toEqual({
      count: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    });
    expect(metrics.cache.totals).toMatchObject({
      requests: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      currentEntries: 0,
      maxEntries: 0,
      hitRatio: 0,
    });
    expect(metrics.database.totals).toMatchObject({
      requests: 0,
      reads: 0,
      writes: 0,
      failedAttempts: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
    });
    expect(metrics.queues.totals).toEqual({
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      rejected: 0,
    });

    expect(metrics.components.api).toMatchObject({
      nodeId: "api",
      type: "api",
    });
    expect(metrics.components.api.traffic).toEqual({
      active: 0,
      peakActive: 0,
      processed: 0,
      attempts: 0,
      failedAttempts: 0,
      retries: 0,
    });
    expect(metrics.components.api.queue).toEqual({
      currentDepth: 0,
      peakDepth: 0,
      totalEnqueued: 0,
      totalDequeued: 0,
      totalDropped: 0,
      totalRejected: 0,
      wait: {
        count: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        minMs: 0,
        maxMs: 0,
      },
    });
  });

  it("reports completed traffic, processing and end-to-end latency for a two-hop pipeline", () => {
    const graph = buildPipelineGraph();
    const { runtime, session } = createFixture(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    // 10 requests, all completing through a 20ms api + 30ms db pipeline.
    expect(metrics.requests.generated).toBe(10);
    expect(metrics.requests.completed).toBe(10);
    expect(metrics.requests.failed).toBe(0);
    expect(metrics.requests.retries).toBe(0);
    expect(metrics.requests.successRate).toBe(1);
    expect(metrics.requests.errorRate).toBe(0);
    expect(metrics.requests.inFlight).toBe(0);
    expect(metrics.requests.queued).toBe(0);

    expect(metrics.failures.total).toBe(0);
    expect(metrics.failures.byReason).toEqual({});
    expect(metrics.failures.byNode).toEqual({});

    // Two transmissions per request (client → api, api → db).
    expect(metrics.network.transmissions).toBe(20);
    expect(metrics.network.packetLosses).toBe(0);
    expect(metrics.network.packetLossRate).toBe(0);
    expect(metrics.network.summary.count).toBe(20);

    // End-to-end latency equals the sum of both processing hops.
    expect(metrics.latency.endToEnd).toMatchObject({
      count: 10,
      avgMs: 50,
      minMs: 50,
      maxMs: 50,
    });
    expect(metrics.latency.failed.count).toBe(0);

    // Processing latency is surfaced both per-component and merged.
    expect(metrics.latency.processing.totals).toMatchObject({
      count: 20,
      avgMs: 25,
      minMs: 20,
      maxMs: 30,
    });
    expect(metrics.latency.processing.byNode.api).toMatchObject({
      count: 10,
      avgMs: 20,
    });
    expect(metrics.latency.processing.byNode.db).toMatchObject({
      count: 10,
      avgMs: 30,
    });

    const apiMetrics = metrics.components.api;

    expect(apiMetrics.traffic).toMatchObject({
      active: 0,
      peakActive: 1,
      processed: 10,
      attempts: 10,
      failedAttempts: 0,
      retries: 0,
    });
    expect(apiMetrics.latency).toMatchObject({
      totalMs: 200,
      avgMs: 20,
      lastMs: 20,
      minMs: 20,
      maxMs: 20,
    });
    expect(apiMetrics.health.state).toBe("healthy");
    expect(apiMetrics.health.transitions).toBe(0);

    // No queueing happened anywhere in this pipeline.
    expect(metrics.queues.totals).toEqual({
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      rejected: 0,
    });
    expect(metrics.queues.byNode).toEqual({});

    expect(metrics.cache.byNode).toEqual({});
    expect(metrics.database.byNode.db).toMatchObject({
      nodeId: "db",
      requests: 10,
      reads: 10,
      writes: 0,
    });
  });

  it("separates network transmission latency from end-to-end latency", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("api", "api", { concurrency: 100, latencyMs: 20 }),
        node("db", "database", { concurrency: 100, latencyMs: 30 }),
      ],
      edges: [
        // Non-zero link latency makes network time observable and distinct
        // from processing time.
        edge("client", "api", { latencyMs: 5 }),
        edge("api", "db", { latencyMs: 3 }),
      ],
    };

    const { runtime, session } = createFixture(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    // Ten requests, each crossing two links (5ms then 3ms).
    expect(metrics.network.transmissions).toBe(20);
    expect(metrics.network.summary.count).toBe(20);
    expect(metrics.network.summary.avgMs).toBe(4);
    expect(metrics.network.totalLatencyMs).toBe(80);

    // The dedicated network histogram mirrors the network summary.
    expect(metrics.latency.network).toEqual(metrics.network.summary);

    // End-to-end latency is strictly the sum of processing hops plus the
    // network transmission latencies — it is not the network time alone.
    expect(metrics.latency.endToEnd).toMatchObject({
      count: 10,
      avgMs: 58,
      minMs: 58,
      maxMs: 58,
    });
    expect(metrics.latency.endToEnd.avgMs).toBe(
      metrics.latency.processing.totals.avgMs * 2 +
        metrics.network.summary.avgMs * 2,
    );
    expect(metrics.latency.processing.totals.avgMs).toBe(25);
  });

  it("records failures and retries per reason and node", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("svc", "api", {
          concurrency: 100,
          latencyMs: 10,
          errorRate: 1,
          retryPolicy: { retries: 2 },
        }),
      ],
      edges: [edge("client", "svc")],
    };

    const { runtime, session } = createFixture(graph);
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.requests.generated).toBe(10);
    expect(metrics.requests.failed).toBe(10);
    expect(metrics.requests.completed).toBe(0);
    expect(metrics.requests.errorRate).toBe(1);

    // Every failed attempt ran twice more through the retry system.
    expect(metrics.requests.retries).toBe(20);
    expect(metrics.failures.total).toBe(10);
    expect(metrics.failures.byReason.component_error).toBe(10);
    expect(metrics.failures.byNode.svc).toBe(10);

    const svc = metrics.components.svc;

    expect(svc.traffic).toMatchObject({
      processed: 0,
      attempts: 30,
      failedAttempts: 30,
      retries: 20,
    });

    // Each request crossed the network once (retries re-process in place).
    expect(metrics.network.transmissions).toBe(10);
    expect(metrics.network.packetLosses).toBe(0);
  });

  it("records packet loss on connections with a packet-loss rate", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "load_balancer"), node("svc", "api")],
      edges: [edge("client", "svc", { packetLossRate: 1 })],
    };

    const { runtime, session } = createFixture(graph);
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.requests.failed).toBe(10);
    expect(metrics.failures.byReason.network_packet_loss).toBe(10);

    expect(metrics.network.transmissions).toBe(10);
    expect(metrics.network.packetLosses).toBe(10);
    expect(metrics.network.packetLossRate).toBe(1);
    expect(metrics.network.summary.count).toBe(0);
  });

  it("tracks queue admissions, wait times, rejections and drops", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          queue: { enabled: true, maxSize: 2, overflowStrategy: "reject" },
        }),
      ],
      edges: [],
    };
    const { runtime } = createFixture(graph);

    runtime.createRequest({
      id: "request-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
    });
    runtime.createRequest({
      id: "request-2",
      status: "pending",
      createdAtMs: 100,
      attempts: 0,
    });
    runtime.createRequest({
      id: "request-3",
      status: "pending",
      createdAtMs: 200,
      attempts: 0,
    });

    expect(runtime.enqueueRequest("api", "request-1")).toMatchObject({
      admitted: true,
    });
    runtime.clock.advanceTo(100);
    expect(runtime.enqueueRequest("api", "request-2")).toMatchObject({
      admitted: true,
    });
    runtime.clock.advanceTo(200);
    expect(runtime.enqueueRequest("api", "request-3")).toMatchObject({
      admitted: false,
      reason: "queue_full",
    });
    runtime.clock.advanceTo(300);
    expect(runtime.dequeueRequest("api")).toBe("request-1");

    const metrics = runtime.getMetrics();
    const api = metrics.components.api;

    expect(metrics.requests.queued).toBe(1);
    expect(api.queue).toMatchObject({
      currentDepth: 1,
      peakDepth: 2,
      totalEnqueued: 2,
      totalDequeued: 1,
      totalRejected: 1,
      totalDropped: 0,
    });
    expect(api.queue.wait).toMatchObject({
      count: 1,
      avgMs: 300,
      minMs: 300,
      maxMs: 300,
    });
    expect(metrics.queues.totals).toEqual({
      enqueued: 2,
      dequeued: 1,
      dropped: 0,
      rejected: 1,
    });
  });

  it("tracks requests dropped by drop_oldest overflow handling", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          queue: {
            enabled: true,
            maxSize: 2,
            overflowStrategy: "drop_oldest",
          },
        }),
      ],
      edges: [],
    };
    const { runtime } = createFixture(graph);

    for (const id of ["request-1", "request-2"]) {
      runtime.createRequest({
        id,
        status: "pending",
        createdAtMs: 0,
        attempts: 0,
      });
      runtime.enqueueRequest("api", id);
      runtime.clock.advanceTo(id === "request-1" ? 50 : 100);
    }
    runtime.createRequest({
      id: "request-3",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
    });
    runtime.enqueueRequest("api", "request-3");

    const metrics = runtime.getMetrics();
    const api = metrics.components.api;

    expect(api.queue).toMatchObject({
      currentDepth: 2,
      peakDepth: 2,
      totalEnqueued: 3,
      totalDequeued: 0,
      totalRejected: 0,
      totalDropped: 1,
    });
    // Eviction is not a dequeue start: the dropped request's wait must not
    // pollute the queue-wait histogram that describes requests that started.
    expect(api.queue.wait).toMatchObject({ count: 0, avgMs: 0, maxMs: 0 });
    expect(metrics.queues.totals).toEqual({
      enqueued: 3,
      dequeued: 0,
      dropped: 1,
      rejected: 0,
    });
  });

  it("records health transitions and time spent in each state", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("api", "api")],
      edges: [],
    };
    const { runtime } = createFixture(graph);

    runtime.clock.advanceTo(50);
    runtime.setComponentHealth("api", "degraded");
    runtime.clock.advanceTo(150);
    runtime.setComponentHealth("api", "failed");
    runtime.clock.advanceTo(250);
    runtime.setComponentHealth("api", "healthy");

    const health = runtime.getMetrics().health.byNode.api;

    expect(health.state).toBe("healthy");
    expect(health.transitions).toBe(3);
    expect(health.failures).toBe(1);
    expect(health.recoveries).toBe(1);
    expect(health.timeInStateMs.healthy).toBe(50);
    expect(health.timeInStateMs.degraded).toBe(100);
    expect(health.timeInStateMs.failed).toBe(100);
  });

  it("records autoscaling evaluations and scale decisions", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          autoscaling: { enabled: true, min: 1, max: 10, targetCpu: 50 },
        }),
      ],
      edges: [],
    };
    const { runtime, processor } = createFixture(graph);

    processor.process(evaluateEvent("api", 0));
    processor.process(scaledEvent("api", 0, 2));
    processor.process(scaledEvent("api", 0, 4));

    const autoscaling = runtime.getMetrics().autoscaling.byNode.api;
    const component = runtime.getMetrics().components.api;

    expect(autoscaling).toMatchObject({
      enabled: true,
      initialReplicas: 1,
      currentReplicas: 4,
      minReplicas: 1,
      maxReplicas: 4,
      scaleUps: 2,
      scaleDowns: 0,
      evaluations: 1,
    });
    expect(component.traffic.processed).toBe(0);
  });

  it("records cache hits, misses and occupancy for a shared key pool", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("cache", "cache", {
          concurrency: 100,
          cache: { capacity: 10, ttlMs: 10_000 },
        }),
      ],
      edges: [edge("client", "cache")],
    };
    const { runtime, session } = createFixture(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
      cacheKeys: ["GET:/users/1"],
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.requests.completed).toBe(10);
    expect(metrics.cache.byNode.cache).toMatchObject({
      requests: 10,
      hits: 9,
      misses: 1,
      hitRatio: 0.9,
      currentEntries: 1,
      maxEntries: 1,
      evictions: 0,
    });
    expect(metrics.cache.totals).toMatchObject({
      requests: 10,
      hits: 9,
      misses: 1,
      hitRatio: 0.9,
    });
    // Only the miss was processed (the fetch filled the cache).
    expect(metrics.components.cache.traffic.processed).toBe(1);
  });

  it("records database operation mix for a database node", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("db", "database", { concurrency: 100, latencyMs: 20 }),
      ],
      edges: [edge("client", "db")],
    };
    const { runtime, session } = createFixture(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
      databaseOperations: ["read", "write"],
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.requests.completed).toBe(10);
    expect(metrics.database.byNode.db).toMatchObject({
      nodeId: "db",
      requests: 10,
      reads: 5,
      writes: 5,
      failedAttempts: 0,
      totalLatencyMs: 200,
      avgLatencyMs: 20,
    });
    expect(metrics.database.totals).toMatchObject({
      reads: 5,
      writes: 5,
      requests: 10,
      totalLatencyMs: 200,
      avgLatencyMs: 20,
    });
  });

  it("is deterministic for the same seed and architecture", () => {
    const run = () => {
      const graph = buildPipelineGraph();
      const { runtime, session } = createFixture(graph, {
        durationMs: 1000,
        requestsPerSecond: 10,
        seed: 42,
      });
      runToEnd(session, "client");
      return runtime.getMetrics();
    };

    const first = run();
    const second = run();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    // Different seeds diverge once the run consumes any randomness.
    const randomGraph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("svc", "api", { concurrency: 100, errorRate: 0.5 }),
      ],
      edges: [edge("client", "svc")],
    };
    const { runtime: otherRuntime, session: otherSession } = createFixture(
      randomGraph,
      {
        durationMs: 1000,
        requestsPerSecond: 10,
        seed: 43,
      },
    );
    runToEnd(otherSession, "client");

    expect(JSON.stringify(otherRuntime.getMetrics())).not.toBe(
      JSON.stringify(first),
    );
  });

  it("produces deeply frozen snapshots that callers cannot mutate", () => {
    const graph = buildPipelineGraph();
    const { runtime, session } = createFixture(graph);
    runToEnd(session, "client");

    const metrics = runtime.getMetrics() as SimulationMetrics;

    expect(Object.isFrozen(metrics)).toBe(true);
    expect(Object.isFrozen(metrics.requests)).toBe(true);
    expect(Object.isFrozen(metrics.latency.processing)).toBe(true);
    expect(Object.isFrozen(metrics.components.api)).toBe(true);
    expect(Object.isFrozen(metrics.components.api.latency)).toBe(true);
    expect(Object.isFrozen(metrics.cache.totals)).toBe(true);

    expect(() => {
      (metrics.requests as { generated: number }).generated = 999;
    }).toThrow();
  });

  it("returns a zeroed snapshot when metrics collection is disabled", () => {
    const graph = buildPipelineGraph();
    const { runtime, session } = createFixture(graph, {
      collectMetrics: false,
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.collectMetrics).toBe(false);
    expect(metrics.processedDurationMs).toBeGreaterThan(0);

    expect(metrics.requests.generated).toBe(0);
    expect(metrics.requests.completed).toBe(0);
    expect(metrics.failures.total).toBe(0);
    expect(metrics.network.transmissions).toBe(0);
    expect(metrics.latency.processing.totals.count).toBe(0);
    expect(metrics.queues.totals).toEqual({
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      rejected: 0,
    });
    expect(metrics.components).toEqual({});
    expect(metrics.autoscaling).toEqual({ byNode: {} });
    expect(metrics.cache.byNode).toEqual({});
    expect(metrics.health.byNode).toEqual({});
  });
});

describe("metrics derive from runtime state", () => {
  it("does not freeze or alias live runtime state when a snapshot is taken", () => {
    const { runtime } = createFixture(buildPipelineGraph());

    runtime.recordRequestFailure("boom", "api");

    const first = runtime.getMetrics();

    expect(first.failures.byReason.boom).toBe(1);
    expect(Object.isFrozen(first.failures.byReason)).toBe(true);

    // Recording after a snapshot must not throw: the snapshot owns a copy, not
    // the runtime's live failure maps.
    expect(() => runtime.recordRequestFailure("boom", "api")).not.toThrow();

    const second = runtime.getMetrics();

    expect(second.failures.byReason.boom).toBe(2);
    // The earlier snapshot is an immutable record of the earlier state.
    expect(first.failures.byReason.boom).toBe(1);
  });

  it("derives per-component traffic and queue depth from live component state", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("api", "api", {
          concurrency: 1,
          latencyMs: 20,
          queue: { enabled: true, maxSize: 5 },
        }),
      ],
      edges: [edge("client", "api")],
    };
    const { runtime, session } = createFixture(graph, {
      durationMs: 1000,
      requestsPerSecond: 20,
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.requests.generated).toBe(
      metrics.requests.completed +
        metrics.requests.failed +
        metrics.requests.inFlight,
    );

    for (const component of Object.values(metrics.components)) {
      const live = runtime.getComponent(component.nodeId);

      expect(component.traffic.processed).toBe(live.processedRequests);
      expect(component.traffic.active).toBe(live.activeRequests);
      expect(component.queue.currentDepth).toBe(
        runtime.getQueuedRequestCount(component.nodeId),
      );
    }

    expect(metrics.components.api.queue.peakDepth).toBeGreaterThanOrEqual(
      metrics.components.api.queue.currentDepth,
    );
  });

  it("derives cache occupancy from the live cache state", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("cache", "cache", {
          concurrency: 100,
          cache: { capacity: 10, ttlMs: 10_000 },
        }),
      ],
      edges: [edge("client", "cache")],
    };
    const { runtime, session } = createFixture(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
      cacheKeys: ["GET:/users/1"],
    });
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();

    expect(metrics.cache.byNode.cache.currentEntries).toBe(
      runtime.getCache("cache").size,
    );
  });

  it("derives the failure total from terminal request state", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "load_balancer"),
        node("svc", "api", {
          concurrency: 100,
          latencyMs: 10,
          errorRate: 1,
          retryPolicy: { retries: 2 },
        }),
      ],
      edges: [edge("client", "svc")],
    };
    const { runtime, session } = createFixture(graph);
    runToEnd(session, "client");

    const metrics = runtime.getMetrics();
    const byReasonTotal = Object.values(metrics.failures.byReason).reduce(
      (sum, count) => sum + count,
      0,
    );

    expect(metrics.failures.total).toBe(metrics.requests.failed);
    expect(metrics.failures.total).toBe(byReasonTotal);
  });
});
