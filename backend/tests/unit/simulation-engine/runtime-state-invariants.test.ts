/**
 * @file runtime-state-invariants.test.ts
 *
 * @description Guards the runtime state-ownership invariants: a queue that
 * survives a failure must be drained after recovery (never stranded), the
 * domain progress cursor must mirror the simulation clock as events process,
 * `effectiveConcurrency` must stay the single representation of derived
 * capacity after scaling, and duplicate queue drains must never over-start
 * requests or lose them.
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

/** The timestamp of the automatic recovery for a failure at t=3 with a 100ms delay. */
const RECOVERY_AT_MS = 103;

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

  return { runtime, engine };
}

describe("recovery drains stranded queues", () => {
  // A single terminal component: one slot, automatic recovery after 100ms.
  const graph: ArchitectureGraph = {
    nodes: [node("api", "api", { latencyMs: 5, recoveryDelayMs: 100 })],
    edges: [],
  };

  it("starts queued requests after recovery when no further traffic arrives", () => {
    const { runtime, engine } = createHarness(graph);

    // req-0 takes the only processing slot; req-1 queues behind it.
    runtime.schedule(
      createEvent({
        simulationId: SIMULATION_ID,
        timestampMs: 0,
        type: "request.processing_started",
        sourceNodeId: "api",
        targetNodeId: "api",
        payload: { requestId: "req-0" },
      }),
    );
    runtime.schedule(
      createEvent({
        simulationId: SIMULATION_ID,
        timestampMs: 0,
        type: "request.processing_started",
        sourceNodeId: "api",
        targetNodeId: "api",
        payload: { requestId: "req-1" },
      }),
    );

    for (const id of ["req-0", "req-1"]) {
      runtime.createRequest({
        id,
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });
    }

    // The component fails while both requests are at the component.
    runtime.schedule(
      createEvent({
        simulationId: SIMULATION_ID,
        timestampMs: 3,
        type: "component.failed",
        sourceNodeId: "api",
      }),
    );

    engine.start();

    // Run everything scheduled before the recovery fires: the failure at t=3
    // and the completion of req-0 at t=5 (which offers a queue.drain that
    // no-ops because the component is failed).
    while (
      runtime.eventQueue.peek() &&
      runtime.eventQueue.peek()!.timestampMs < RECOVERY_AT_MS
    ) {
      engine.step();
    }

    expect(runtime.getComponent("api").health).toBe("failed");
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.getQueuedRequestCount("api")).toBe(1);
    expect(runtime.getRequest("req-1").status).toBe("queued");
    expect(runtime.getRequest("req-0").status).toBe("completed");

    // The progress cursor mirrors the clock after every processed event.
    expect(runtime.simulation.currentTimeMs).toBe(runtime.currentTimeMs);

    while (engine.hasPendingEvents()) {
      engine.step();
    }

    // Recovery must offer the freed capacity to the stranded queue: req-1
    // starts, completes, and nothing is left queued or active.
    expect(runtime.getComponent("api").health).toBe("healthy");
    expect(runtime.getRequest("req-1").status).toBe("completed");
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.simulation.currentTimeMs).toBe(runtime.currentTimeMs);
    expect(runtime.simulation.status).toBe("completed");
  });
});

describe("effective concurrency single source", () => {
  const graph: ArchitectureGraph = {
    nodes: [node("api", "api", { replicas: 1, concurrency: 2 })],
    edges: [],
  };

  it("keeps the stored field and the runtime getter in sync across scaling", () => {
    const { runtime } = createHarness(graph);

    expect(runtime.getComponent("api").effectiveConcurrency).toBe(2);
    expect(runtime.getEffectiveConcurrency("api")).toBe(2);

    runtime.setComponentReplicas("api", 3);

    expect(runtime.getComponent("api").effectiveConcurrency).toBe(6);
    expect(runtime.getEffectiveConcurrency("api")).toBe(6);

    expect(runtime.hasCapacity("api")).toBe(true);

    for (let i = 0; i < 6; i++) {
      runtime.incrementActiveRequests("api");
    }

    expect(runtime.hasCapacity("api")).toBe(false);

    runtime.decrementActiveRequests("api");

    expect(runtime.hasCapacity("api")).toBe(true);
  });
});

describe("duplicate queue drains are self-correcting", () => {
  // Two processing slots; three requests wait in the queue while the
  // component is idle, then two queue.drain events collide at one timestamp
  // (the completion + scale-up + recovery collision).
  const graph: ArchitectureGraph = {
    nodes: [node("api", "api", { latencyMs: 5, concurrency: 2 })],
    edges: [],
  };

  it("never over-starts requests and eventually processes every queued request", () => {
    const { runtime, engine } = createHarness(graph);

    for (const id of ["req-0", "req-1", "req-2"]) {
      runtime.createRequest({
        id,
        status: "queued",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });
      runtime.enqueueRequest("api", id);
    }

    expect(runtime.getQueuedRequestCount("api")).toBe(3);

    // Two drains at the same timestamp: the second fires before the first
    // drain's processing_started events have incremented the active count,
    // so it dequeues with a stale view of available capacity.
    for (let i = 0; i < 2; i++) {
      runtime.schedule(
        createEvent({
          simulationId: SIMULATION_ID,
          timestampMs: 1,
          type: "queue.drain",
          sourceNodeId: "api",
        }),
      );
    }

    engine.start();

    while (engine.hasPendingEvents()) {
      engine.step();

      // Capacity is a hard invariant: the start path re-checks it, so even an
      // over-dequeued drain can never push active requests past the limit.
      expect(runtime.getActiveRequestCount("api")).toBeLessThanOrEqual(2);
    }

    // The over-drained request is re-queued by the start gate and finished by
    // a later drain — nothing is lost and nothing starts twice.
    for (const id of ["req-0", "req-1", "req-2"]) {
      expect(runtime.getRequest(id).status).toBe("completed");
    }

    expect(runtime.getQueuedRequestCount("api")).toBe(0);
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.simulation.status).toBe("completed");

    // The over-drained request round-trips the queue exactly once: dequeued
    // by the stale second drain, re-queued by the start gate, then dequeued
    // again by a later drain — the documented benign metric inflation.
    expect(runtime.getMetrics().components.api.queue).toMatchObject({
      totalEnqueued: 4,
      totalDequeued: 4,
    });
  });
});
