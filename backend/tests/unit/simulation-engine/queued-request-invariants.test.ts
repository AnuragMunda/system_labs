/**
 * @file queued-request-invariants.test.ts
 *
 * @description Guards the queued-request lifecycle: a queued request may only
 * leave the queue via `queue.drain` → `request.processing_started` (dequeued,
 * then in-flight) — never via completion-side finalization — and a request
 * dropped by queue overflow always reaches a terminal state and can never
 * reappear in the queue.
 */

import { describe, expect, it } from "vitest";

import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { createEvent } from "@/simulation-engine/utils/helpers.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { SimulationRequest } from "@/domain/simulation/request.types.js";

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

  return { runtime, processor };
}

function createRequest(
  runtime: SimulationRuntime,
  id: string,
  status: SimulationRequest["status"],
): void {
  runtime.createRequest({
    id,
    status,
    createdAtMs: 0,
    attempts: 0,
    currentNodeId: "api",
  });
}

/** Builds a lifecycle event for the request under test. */
function lifecycleEvent(
  type: SimulationEvent["type"],
  requestId: string,
  payload: Record<string, unknown> = {},
  extra: Partial<SimulationEvent> = {},
): SimulationEvent {
  return createEvent({
    simulationId: SIMULATION_ID,
    timestampMs: 1,
    type,
    sourceNodeId: "api",
    payload: { requestId, ...payload },
    ...extra,
  });
}

/** Empties the runtime's event queue, returning the events in processing order. */
function takeScheduledEvents(runtime: SimulationRuntime): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  while (!runtime.eventQueue.isEmpty()) {
    events.push(runtime.eventQueue.dequeue()!);
  }

  return events;
}

describe("queued requests are never finalized without executing", () => {
  const graph: ArchitectureGraph = {
    nodes: [node("api", "api", { latencyMs: 5 })],
    edges: [],
  };

  it("rejects request.completed for a queued request", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "queued");

    expect(() =>
      processor.process(lifecycleEvent("request.completed", "req-1")),
    ).toThrow(
      "request.completed cannot run for a queued request: request req-1 has not started processing.",
    );

    expect(runtime.getRequest("req-1").status).toBe("queued");
  });

  it("rejects request.processing_completed for a queued request", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "queued");

    expect(() =>
      processor.process(
        lifecycleEvent("request.processing_completed", "req-1", {
          processingStartedAtMs: 0,
        }),
      ),
    ).toThrow(
      "request.processing_completed cannot run for a queued request: request req-1 has not started processing.",
    );

    // No latency was recorded and the active count was not decremented.
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.getRequest("req-1").status).toBe("queued");
  });
});

describe("queue overflow drops reach a terminal state", () => {
  it("fails the arrival terminally when a maxSize: 0 drop_oldest queue is full", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          concurrency: 1,
          queue: { maxSize: 0, overflowStrategy: "drop_oldest" },
        }),
      ],
      edges: [],
    };

    const { runtime, processor } = createHarness(graph);

    runtime.incrementActiveRequests("api");
    createRequest(runtime, "req-1", "in-flight");

    // There is nothing to evict from an always-full empty queue; the arrival
    // must be rejected (queue_overflow) instead of failing the run.
    expect(() =>
      processor.process(lifecycleEvent("request.processing_started", "req-1")),
    ).not.toThrow();

    const failed = takeScheduledEvents(runtime).find(
      (e) => e.type === "request.failed",
    );

    expect(failed).toMatchObject({
      type: "request.failed",
      payload: { requestId: "req-1", reason: "queue_overflow" },
    });

    if (failed) {
      processor.process(failed);
    }

    expect(runtime.getRequest("req-1").status).toBe("failed");
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });

  it("never re-admits an evicted request after the drain that follows", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("api", "api", {
          concurrency: 1,
          queue: { maxSize: 1, overflowStrategy: "drop_oldest" },
        }),
      ],
      edges: [],
    };

    const { runtime, processor } = createHarness(graph);

    runtime.incrementActiveRequests("api");
    createRequest(runtime, "req-1", "in-flight");
    createRequest(runtime, "req-2", "in-flight");

    // req-1 fills the single queue slot; req-2 evicts it.
    processor.process(lifecycleEvent("request.processing_started", "req-1"));
    processor.process(lifecycleEvent("request.processing_started", "req-2"));

    const failed = takeScheduledEvents(runtime).find(
      (e) => e.type === "request.failed",
    );

    expect(failed?.payload?.requestId).toBe("req-1");

    if (failed) {
      processor.process(failed);
    }

    expect(runtime.getRequest("req-1").status).toBe("failed");

    // Capacity frees and the queue drains: only the surviving newcomer is
    // dequeued — the evicted request can never reappear in the queue.
    runtime.decrementActiveRequests("api");
    processor.process(
      createEvent({
        simulationId: SIMULATION_ID,
        timestampMs: 5,
        type: "queue.drain",
        sourceNodeId: "api",
      }),
    );

    const scheduled = takeScheduledEvents(runtime);
    const started = scheduled.find(
      (e) => e.type === "request.processing_started",
    );

    expect(started?.payload?.requestId).toBe("req-2");
    expect(scheduled.some((e) => e.payload?.requestId === "req-1")).toBe(false);
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
    expect(runtime.getRequest("req-1").status).toBe("failed");
    expect(runtime.getRequest("req-2").status).toBe("queued");
  });
});
