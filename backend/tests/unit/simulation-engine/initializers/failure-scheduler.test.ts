import { describe, expect, it } from "vitest";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import {
  FailureSchedule,
  Simulation,
} from "@/domain/simulation/simulation.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";

function createSimulation(
  failures: FailureSchedule[] = [],
  durationMs = 1000,
): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
      failures,
    },
    currentTimeMs: 0,
    seed: 42,
    architectureSnapshot: {
      nodes: [
        {
          id: "api",
          type: "api",
          name: "api",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
    } satisfies ArchitectureGraph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function scheduleFailures(
  failures: FailureSchedule[],
  durationMs = 1000,
): {
  runtime: SimulationRuntime;
  events: ReturnType<SimulationRuntime["eventQueue"]["dequeue"]>[];
} {
  const runtime = new SimulationRuntime(createSimulation(failures, durationMs));
  const scheduler = new FailureScheduler(runtime);

  scheduler.schedule();

  const events = [];

  while (!runtime.eventQueue.isEmpty()) {
    events.push(runtime.eventQueue.dequeue());
  }

  return { runtime, events };
}

describe("FailureScheduler", () => {
  it("should schedule a component.failed event at the failure time", () => {
    const { events } = scheduleFailures([{ nodeId: "api", failedAtMs: 50 }]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "component.failed",
      timestampMs: 50,
      sourceNodeId: "api",
    });
  });

  it("should not schedule recovery when no recovery time is given", () => {
    const { events } = scheduleFailures([{ nodeId: "api", failedAtMs: 50 }]);

    expect(events.some((event) => event.type === "component.recovered")).toBe(
      false,
    );
  });

  it("should schedule failures for every configured entry", () => {
    const { events } = scheduleFailures([
      { nodeId: "api", failedAtMs: 10 },
      { nodeId: "api", failedAtMs: 50 },
    ]);

    expect(
      events.filter((event) => event.type === "component.failed"),
    ).toHaveLength(2);
  });

  it("should schedule nothing when no failures are configured", () => {
    const { events } = scheduleFailures([]);

    expect(events).toHaveLength(0);
  });

  it.each<FailureSchedule>([
    { nodeId: "api", failedAtMs: 1000 },
    { nodeId: "api", failedAtMs: 1500 },
  ])(
    "should throw when failedAtMs is not below the duration ($failedAtMs)",
    (failure) => {
      expect(() => scheduleFailures([failure], 1000)).toThrow(
        "must be less than simulation duration 1000",
      );
    },
  );

  it("should throw when failedAtMs is negative", () => {
    expect(() => scheduleFailures([{ nodeId: "api", failedAtMs: -1 }])).toThrow(
      "Failure time cannot be negative: -1",
    );
  });

  it("should throw when the failure targets an unknown node", () => {
    expect(() =>
      scheduleFailures([{ nodeId: "unknown-node", failedAtMs: 50 }]),
    ).toThrow("Node not found: unknown-node");
  });
});
