/**
 * @file simulation-session.test.ts
 *
 * @description Tests for the composition seam between simulation setup and
 * execution: `SimulationSession` generates the load and schedules configured
 * failures/autoscaling, then hands execution to the engine. The engine itself
 * stays a pure execution coordinator.
 */

import { describe, expect, it, vi } from "vitest";

import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationSession } from "@/simulation-engine/core/simulation-session.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import {
  Simulation,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function edge(source: string, target: string) {
  return { id: `${source}-${target}`, source, target, config: {} };
}

/** A minimal client → api graph, configurable for failure/autoscaling setup. */
function createGraph(overrides: {
  concurrency?: number;
  latencyMs?: number;
  autoscaling?: Record<string, unknown>;
  failures?: { nodeId: string; failedAtMs: number }[];
}): ArchitectureGraph {
  return {
    nodes: [
      node("client", "load_balancer"),
      node("api", "api", {
        concurrency: overrides.concurrency ?? 100,
        latencyMs: overrides.latencyMs ?? 10,
        autoscaling: overrides.autoscaling,
      }),
    ],
    edges: [edge("client", "api")],
  };
}

function createSimulation(overrides?: {
  seed?: number;
  status?: SimulationStatus;
  durationMs?: number;
  requestsPerSecond?: number;
  graph?: ArchitectureGraph;
  failures?: { nodeId: string; failedAtMs: number }[];
}): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: overrides?.status ?? "created",
    config: {
      durationMs: overrides?.durationMs ?? 1000,
      requestsPerSecond: overrides?.requestsPerSecond ?? 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
      failures: overrides?.failures,
    },
    currentTimeMs: 0,
    seed: overrides?.seed ?? 42,
    architectureSnapshot: overrides?.graph ?? createGraph({}),
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createSession(simulation: Simulation): {
  runtime: SimulationRuntime;
  session: SimulationSession;
} {
  const runtime = new SimulationRuntime(simulation);
  const processor = new DefaultEventProcessor(
    runtime,
    new AutoscalingController(runtime),
    new AutoscalingScheduler(runtime),
  );
  const engine = new SimulationEngine(runtime, processor);
  const session = new SimulationSession(
    runtime,
    engine,
    new TrafficGenerator(runtime),
    new FailureScheduler(runtime),
    new AutoscalingScheduler(runtime),
  );

  return { runtime, session };
}

describe("SimulationSession", () => {
  it("generates the initial load without changing status or advancing the clock", () => {
    const { runtime, session } = createSession(createSimulation());

    session.prepare("client");

    expect(runtime.simulation.status).toBe("created");
    expect(runtime.clock.now()).toBe(0);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(10);
    expect(events[0]).toMatchObject({
      type: "request.created",
      sourceNodeId: "client",
      timestampMs: 0,
    });

    for (let i = 0; i < 10; i++) {
      expect(runtime.getRequest(`simulation-1:request:${i}`)).toBeDefined();
    }
  });

  it("queues configured failure and autoscaling events alongside the load", () => {
    const simulation = createSimulation({
      durationMs: 5000,
      graph: createGraph({
        autoscaling: { enabled: true, min: 1, max: 10, targetCpu: 50 },
      }),
      failures: [{ nodeId: "api", failedAtMs: 50 }],
    });
    const { runtime, session } = createSession(simulation);

    session.prepare("client");

    const events = drainEvents(runtime);

    expect(
      events.filter((event) => event.type === "request.created"),
    ).toHaveLength(50);

    expect(
      events.find(
        (event) =>
          event.type === "component.failed" && event.sourceNodeId === "api",
      ),
    ).toMatchObject({ timestampMs: 50 });

    expect(
      events.find(
        (event) =>
          event.type === "autoscaling.evaluate" && event.sourceNodeId === "api",
      ),
    ).toMatchObject({ timestampMs: 1000 });
  });

  it.each(["running", "paused", "completed", "failed", "cancelled"])(
    "throws when prepared from status %s",
    (status) => {
      const { session } = createSession(createSimulation({ status }));

      expect(() => session.prepare("client")).toThrow(
        `Simulation cannot be prepared from status ${status}`,
      );
    },
  );

  it("prepares and executes a simulation to completion", () => {
    const { runtime, session } = createSession(createSimulation());

    session.run("client");

    expect(runtime.simulation.status).toBe("completed");
    expect(runtime.eventQueue.isEmpty()).toBe(true);

    const request = runtime.getRequest("simulation-1:request:0");

    expect(request.status).toBe("completed");
    expect(runtime.currentTimeMs).toBeLessThanOrEqual(1000);
  });

  it("throws on run when the simulation is not created", () => {
    const { session } = createSession(createSimulation({ status: "running" }));

    expect(() => session.run("client")).toThrow(
      /Simulation cannot be prepared from status running/,
    );
  });

  it("leaves traffic generation out of the engine's responsibility", () => {
    const runtime = new SimulationRuntime(createSimulation());
    const engine = new SimulationEngine(runtime, { process: vi.fn() });

    vi.spyOn(TrafficGenerator.prototype, "generate");

    new SimulationSession(
      runtime,
      engine,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // The engine itself only exposes execution coordination.
    expect(
      (engine as unknown as Record<string, unknown>).initializeTraffic,
    ).toBeUndefined();
    expect(
      (engine as unknown as Record<string, unknown>).initializeFailures,
    ).toBeUndefined();
    expect(
      (engine as unknown as Record<string, unknown>).initializeAutoscaling,
    ).toBeUndefined();
  });

  it("produces an identical event sequence across two runs with the same seed and snapshot", () => {
    const graph = createGraph({
      autoscaling: { enabled: true, min: 1, max: 10, targetCpu: 50 },
      failures: [{ nodeId: "api", failedAtMs: 50 }],
    });

    const firstRun = captureProcessedEvents(
      createSimulation({
        seed: 1337,
        durationMs: 3000,
        requestsPerSecond: 50,
        graph,
        failures: [{ nodeId: "api", failedAtMs: 50 }],
      }),
    );

    const secondRun = captureProcessedEvents(
      createSimulation({
        seed: 1337,
        durationMs: 3000,
        requestsPerSecond: 50,
        graph,
        failures: [{ nodeId: "api", failedAtMs: 50 }],
      }),
    );

    // Ordering is part of the contract: same seed + same snapshot must replay
    // the exact same (type, timestamp) sequence, including every tie-break.
    expect(firstRun.length).toBeGreaterThan(0);
    expect(secondRun).toEqual(firstRun);
  });
});

/** Pops every queued event, returning them in processing order. */
function drainEvents(runtime: SimulationRuntime): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  while (true) {
    const event = runtime.eventQueue.dequeue();

    if (!event) {
      break;
    }

    events.push(event);
  }

  return events;
}

/**
 * Runs a fresh session to completion and returns the processed event stream as
 * ordered `(type, timestampMs)` pairs — the externally observable ordering of
 * a run, independent of generated event ids.
 */
function captureProcessedEvents(
  simulation: Simulation,
): { type: SimulationEvent["type"]; timestampMs: number }[] {
  const processed: { type: SimulationEvent["type"]; timestampMs: number }[] =
    [];
  const original = DefaultEventProcessor.prototype.process;

  vi.spyOn(DefaultEventProcessor.prototype, "process").mockImplementation(
    function (event: SimulationEvent) {
      processed.push({ type: event.type, timestampMs: event.timestampMs });
      original.call(this, event);
    },
  );

  try {
    createSession(simulation).session.run("client");
  } finally {
    vi.restoreAllMocks();
  }

  return processed;
}
