/**
 * @file terminal-request-invariants.test.ts
 *
 * @description Guards the terminal-state rule: once a request is `completed`
 * or `failed`, no later lifecycle event may resurrect it, record metrics
 * against it, or corrupt component capacity. Producers are exclusive by
 * construction, so these tests inject out-of-order events to prove the
 * explicit handler guards fire instead of relying on that exclusivity
 * silently.
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

describe("terminal request states are sticky", () => {
  // A single terminal component; guards are independent of topology shape.
  const graph: ArchitectureGraph = {
    nodes: [node("api", "api", { latencyMs: 5 })],
    edges: [],
  };

  it("rejects request.retry after a terminal failure", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "in-flight");

    processor.process(lifecycleEvent("request.failed", "req-1"));

    expect(runtime.getRequest("req-1").status).toBe("failed");

    expect(() =>
      processor.process(lifecycleEvent("request.retry", "req-1")),
    ).toThrow(
      "request.retry cannot follow a terminal state: request req-1 is already failed.",
    );

    // The resurrecting follow-up was never scheduled and no retry was counted.
    expect(runtime.eventQueue.isEmpty()).toBe(true);
    expect(runtime.getMetrics().requests.retries).toBe(0);
  });

  it("rejects request.retry after a terminal completion", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "in-flight");

    processor.process(lifecycleEvent("request.completed", "req-1"));

    expect(runtime.getRequest("req-1").status).toBe("completed");

    expect(() =>
      processor.process(lifecycleEvent("request.retry", "req-1")),
    ).toThrow(
      "request.retry cannot follow a terminal state: request req-1 is already completed.",
    );

    expect(runtime.eventQueue.isEmpty()).toBe(true);
    expect(runtime.getMetrics().requests.retries).toBe(0);
  });

  it("rejects a second terminal failure without double-counting metrics", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "in-flight");

    processor.process(lifecycleEvent("request.failed", "req-1"));

    expect(() =>
      processor.process(lifecycleEvent("request.failed", "req-1")),
    ).toThrow(
      "request.failed cannot follow a terminal state: request req-1 is already failed.",
    );

    expect(runtime.getMetrics().failures.total).toBe(1);
    expect(runtime.getMetrics().requests.failed).toBe(1);
  });

  it("rejects processing_started for a terminal request", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "in-flight");

    processor.process(lifecycleEvent("request.failed", "req-1"));

    expect(() =>
      processor.process(lifecycleEvent("request.processing_started", "req-1")),
    ).toThrow(
      "request.processing_started cannot follow a terminal state: request req-1 is already failed.",
    );

    // No active slot was claimed and no completion was scheduled.
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.eventQueue.isEmpty()).toBe(true);
  });

  it("rejects request.routed for a completed request", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "in-flight");

    processor.process(lifecycleEvent("request.completed", "req-1"));

    expect(() =>
      processor.process(
        lifecycleEvent("request.routed", "req-1", {}, { targetNodeId: "api" }),
      ),
    ).toThrow(
      "request.routed cannot follow a terminal state: request req-1 is already completed.",
    );

    expect(runtime.getRequest("req-1").status).toBe("completed");
    expect(runtime.eventQueue.isEmpty()).toBe(true);
  });

  it("rejects processing_completed for a terminal request", () => {
    const { runtime, processor } = createHarness(graph);
    createRequest(runtime, "req-1", "in-flight");

    processor.process(lifecycleEvent("request.failed", "req-1"));

    expect(() =>
      processor.process(
        lifecycleEvent("request.processing_completed", "req-1", {
          processingStartedAtMs: 0,
        }),
      ),
    ).toThrow(
      "request.processing_completed cannot follow a terminal state: request req-1 is already failed.",
    );

    // The component's active count was not decremented on the request's behalf.
    expect(runtime.getActiveRequestCount("api")).toBe(0);
    expect(runtime.eventQueue.isEmpty()).toBe(true);
  });

  it("rejects crossing between the two terminal states", () => {
    const { runtime, processor } = createHarness(graph);

    createRequest(runtime, "req-1", "in-flight");
    processor.process(lifecycleEvent("request.failed", "req-1"));

    expect(() =>
      processor.process(lifecycleEvent("request.completed", "req-1")),
    ).toThrow(
      "request.completed cannot follow a terminal state: request req-1 is already failed.",
    );

    createRequest(runtime, "req-2", "in-flight");
    processor.process(lifecycleEvent("request.completed", "req-2"));

    expect(() =>
      processor.process(lifecycleEvent("request.failed", "req-2")),
    ).toThrow(
      "request.failed cannot follow a terminal state: request req-2 is already completed.",
    );
  });

  it("still allows non-terminal requests to reach a terminal state", () => {
    const { runtime, processor } = createHarness(graph);

    createRequest(runtime, "req-1", "pending");
    processor.process(lifecycleEvent("request.failed", "req-1"));
    expect(runtime.getRequest("req-1").status).toBe("failed");

    // `in-flight` is the normal pre-completion status.
    createRequest(runtime, "req-2", "in-flight");
    processor.process(lifecycleEvent("request.completed", "req-2"));
    expect(runtime.getRequest("req-2").status).toBe("completed");

    // `queued → failed` stays legal (overflow/circuit failures happen before
    // a queued request starts); only completion-side finalization is blocked.
    createRequest(runtime, "req-3", "queued");
    processor.process(
      lifecycleEvent("request.failed", "req-3", { reason: "queue_overflow" }),
    );
    expect(runtime.getRequest("req-3").status).toBe("failed");
  });
});
