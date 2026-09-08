import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { describe, expect, it, vi } from "vitest";

function createEvent(id: string, timestampMs: number): SimulationEvent {
  return {
    id,
    simulationId: "simulation-1",
    timestampMs,
    type: "request.created",
  };
}

function createSimulation(overrides?: {
  seed?: number;
  architectureSnapshot?: ArchitectureGraph;
}): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "running",
    config: {
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    currentTimeMs: 0,
    seed: overrides?.seed ?? 42,
    architectureSnapshot: overrides?.architectureSnapshot ?? {
      nodes: [],
      edges: [],
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createFixture() {
  const simulation = createSimulation();
  const runtime = new SimulationRuntime(simulation);
  const eventProcessor = { process: vi.fn() };
  const engine = new SimulationEngine(runtime, eventProcessor);

  return { simulation, runtime, engine, eventProcessor };
}

describe("SimulationRuntime", () => {
  it("should start at zero time", () => {
    const { runtime } = createFixture();

    expect(runtime.currentTimeMs).toBe(0);
  });

  it("should put a scheduled event into its queue", () => {
    const { runtime } = createFixture();

    const event = createEvent("event-1", 100);

    runtime.schedule(event);

    expect(runtime.eventQueue.size()).toBe(1);
    expect(runtime.eventQueue.peek()).toBe(event);
  });

  it("should initialize deterministic randomness from the simulation seed", () => {
    const simulationA = createSimulation({ seed: 42 });
    const simulationB = createSimulation({ seed: 42 });

    const runtimeA = new SimulationRuntime(simulationA);
    const runtimeB = new SimulationRuntime(simulationB);

    expect(runtimeA.random.next()).toBe(runtimeB.random.next());
    expect(runtimeA.random.next()).toBe(runtimeB.random.next());
    expect(runtimeA.random.next()).toBe(runtimeB.random.next());
  });

  it("should produce independent random sequences for different seeds", () => {
    const simulationA = createSimulation({ seed: 42 });
    const simulationB = createSimulation({ seed: 43 });

    const runtimeA = new SimulationRuntime(simulationA);
    const runtimeB = new SimulationRuntime(simulationB);

    expect(runtimeA.random.next()).not.toBe(runtimeB.random.next());
  });

  it("should track the active request count for a node", () => {
    const graph: ArchitectureGraph = {
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
    };

    const runtime = new SimulationRuntime(
      createSimulation({ architectureSnapshot: graph }),
    );

    expect(runtime.getActiveRequestCount("api")).toBe(0);

    runtime.incrementActiveRequests("api");
    runtime.incrementActiveRequests("api");

    expect(runtime.getActiveRequestCount("api")).toBe(2);

    runtime.decrementActiveRequests("api");

    expect(runtime.getActiveRequestCount("api")).toBe(1);
  });

  it("should default effective concurrency to 1 for an unconfigured node", () => {
    const graph: ArchitectureGraph = {
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
    };

    const runtime = new SimulationRuntime(
      createSimulation({ architectureSnapshot: graph }),
    );

    expect(runtime.getEffectiveConcurrency("api")).toBe(1);
  });

  it("should multiply replicas by concurrency for the effective concurrency", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        {
          id: "api",
          type: "api",
          name: "api",
          position: { x: 0, y: 0 },
          config: { replicas: 2, concurrency: 5 },
        },
      ],
      edges: [],
    };

    const runtime = new SimulationRuntime(
      createSimulation({ architectureSnapshot: graph }),
    );

    expect(runtime.getEffectiveConcurrency("api")).toBe(10);
  });

  it("should throw when computing effective concurrency for an unknown node", () => {
    const runtime = new SimulationRuntime(createSimulation());

    expect(() => runtime.getEffectiveConcurrency("missing")).toThrow(
      "Node not found: missing.",
    );
  });

  it("should report capacity while active requests are below effective concurrency", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        {
          id: "api",
          type: "api",
          name: "api",
          position: { x: 0, y: 0 },
          config: { replicas: 2, concurrency: 2 },
        },
      ],
      edges: [],
    };

    const runtime = new SimulationRuntime(
      createSimulation({ architectureSnapshot: graph }),
    );

    expect(runtime.hasCapacity("api")).toBe(true);

    runtime.incrementActiveRequests("api");
    runtime.incrementActiveRequests("api");
    runtime.incrementActiveRequests("api");
    runtime.incrementActiveRequests("api");

    expect(runtime.hasCapacity("api")).toBe(false);
  });
});

describe("SimulationEngine", () => {
  it("should advance the runtime clock to a single event's timestamp", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    engine.schedule(createEvent("event-a", 100));

    engine.run();

    expect(eventProcessor.process).toHaveBeenCalledTimes(1);
    expect(runtime.currentTimeMs).toBe(100);
  });

  it("should process unordered events in timestamp order and end at the latest", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 20));
    engine.schedule(createEvent("event-c", 50));

    engine.run();

    const processedTimes = eventProcessor.process.mock.calls.map(
      ([event]) => event.timestampMs,
    );

    expect(processedTimes).toEqual([20, 50, 100]);
    expect(runtime.currentTimeMs).toBe(100);
  });

  it("should process already-ordered events without reordering", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    engine.schedule(createEvent("event-1", 10));
    engine.schedule(createEvent("event-2", 20));
    engine.schedule(createEvent("event-3", 30));

    engine.run();

    const processedTimes = eventProcessor.process.mock.calls.map(
      ([event]) => event.timestampMs,
    );

    expect(processedTimes).toEqual([10, 20, 30]);
    expect(runtime.currentTimeMs).toBe(30);
  });

  it("should never move the clock backwards while processing events", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    const processedTimes: number[] = [];

    eventProcessor.process.mockImplementation(() => {
      processedTimes.push(runtime.currentTimeMs);
    });

    engine.schedule(createEvent("event-1", 30));
    engine.schedule(createEvent("event-2", 10));
    engine.schedule(createEvent("event-3", 20));

    engine.run();

    // The queue drains in ascending order, so every processing step happens
    // at (or after) the previous one — the clock is monotonic by construction.
    expect(processedTimes).toEqual([10, 20, 30]);

    for (let i = 1; i < processedTimes.length; i++) {
      expect(processedTimes[i]!).toBeGreaterThanOrEqual(processedTimes[i - 1]!);
    }
  });
});
