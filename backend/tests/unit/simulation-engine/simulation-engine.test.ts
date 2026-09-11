import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import {
  Simulation,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";
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
  status?: SimulationStatus;
  architectureSnapshot?: ArchitectureGraph;
}): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: overrides?.status ?? "created",
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
    startedAt: new Date("2026-01-01T00:00:00Z"),
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

  it("should enqueue a request and report queued count", () => {
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

    runtime.enqueueRequest("api", "request-1");

    expect(runtime.getQueuedRequestCount("api")).toBe(1);
  });

  it("should dequeue a request from a component queue", () => {
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

    runtime.enqueueRequest("api", "request-1");

    const requestId = runtime.dequeueRequest("api");

    expect(requestId).toBe("request-1");
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });

  it("should dequeue requests in FIFO order through the runtime", () => {
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

    runtime.enqueueRequest("api", "request-1");
    runtime.enqueueRequest("api", "request-2");
    runtime.enqueueRequest("api", "request-3");

    expect(runtime.dequeueRequest("api")).toBe("request-1");
    expect(runtime.dequeueRequest("api")).toBe("request-2");
    expect(runtime.dequeueRequest("api")).toBe("request-3");
  });

  it("should maintain independent queues per component", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        {
          id: "api",
          type: "api",
          name: "api",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "worker",
          type: "worker",
          name: "worker",
          position: { x: 100, y: 0 },
          config: {},
        },
      ],
      edges: [],
    };

    const runtime = new SimulationRuntime(
      createSimulation({ architectureSnapshot: graph }),
    );

    runtime.enqueueRequest("api", "request-1");
    runtime.enqueueRequest("worker", "request-2");

    expect(runtime.dequeueRequest("api")).toBe("request-1");
    expect(runtime.dequeueRequest("worker")).toBe("request-2");
  });

  it("should clear component request queues on reset", () => {
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

    runtime.enqueueRequest("api", "request-1");

    runtime.reset();

    expect(runtime.getQueuedRequestCount("api")).toBe(0);
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

  it("should run a created simulation to completion", () => {
    const { simulation, engine } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(simulation.status).toBe("completed");
  });

  it("should be running while events are being processed", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    let statusDuringRun: SimulationStatus | undefined;

    eventProcessor.process.mockImplementation(() => {
      statusDuringRun = runtime.simulation.status;
    });

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(statusDuringRun).toBe("running");
    expect(runtime.simulation.status).toBe("completed");
  });

  it("should throw when a completed simulation is run again", () => {
    const { engine } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(() => engine.run()).toThrow(
      "Simulation cannot be run from status completed",
    );
  });

  it("should throw when a failed simulation is run", () => {
    const simulation = createSimulation({ status: "failed" });
    const runtime = new SimulationRuntime(simulation);
    const engine = new SimulationEngine(runtime, { process: vi.fn() });

    expect(() => engine.run()).toThrow(
      "Simulation cannot be run from status failed",
    );
  });

  it("should throw when a cancelled simulation is run", () => {
    const simulation = createSimulation({ status: "cancelled" });
    const runtime = new SimulationRuntime(simulation);
    const engine = new SimulationEngine(runtime, { process: vi.fn() });

    expect(() => engine.run()).toThrow(
      "Simulation cannot be run from status cancelled",
    );
  });

  it("should complete an empty simulation without advancing the clock", () => {
    const { runtime, engine } = createFixture();

    engine.run();

    expect(runtime.simulation.status).toBe("completed");
    expect(runtime.currentTimeMs).toBe(0);
  });

  it("should mark the simulation as failed when the processor throws", () => {
    const simulation = createSimulation();
    const runtime = new SimulationRuntime(simulation);
    const processEvent = vi.fn(() => {
      throw new Error("Processing failed");
    });
    const engine = new SimulationEngine(runtime, { process: processEvent });

    engine.schedule(createEvent("event-a", 100));

    expect(() => engine.run()).toThrow("Processing failed");
    expect(runtime.simulation.status).toBe("failed");
  });

  it("should keep the clock at the event that failed processing", () => {
    const simulation = createSimulation();
    const runtime = new SimulationRuntime(simulation);
    const processEvent = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new Error("Processing failed");
      });
    const engine = new SimulationEngine(runtime, { process: processEvent });

    engine.schedule(createEvent("event-1", 100));
    engine.schedule(createEvent("event-2", 200));

    expect(() => engine.run()).toThrow("Processing failed");
    expect(runtime.clock.now()).toBe(200);
    expect(runtime.simulation.status).toBe("failed");
  });

  it("should throw when a failed simulation is run again", () => {
    const simulation = createSimulation();
    const runtime = new SimulationRuntime(simulation);
    const processEvent = vi.fn(() => {
      throw new Error("Processing failed");
    });
    const engine = new SimulationEngine(runtime, { process: processEvent });

    engine.schedule(createEvent("event-a", 100));

    expect(() => engine.run()).toThrow("Processing failed");

    expect(() => engine.run()).toThrow(
      "Simulation cannot be run from status failed",
    );
  });

  it("should set startedAt when run begins", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    let startedAtDuringRun: Date | undefined;

    eventProcessor.process.mockImplementation(() => {
      startedAtDuringRun = runtime.simulation.startedAt;
    });

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(startedAtDuringRun).toBeInstanceOf(Date);
    expect(Number.isNaN(startedAtDuringRun?.getTime())).toBe(false);
  });

  it("should set completedAt when the simulation completes", () => {
    const { simulation, engine } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(simulation.completedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(simulation.completedAt?.getTime())).toBe(false);
  });

  it("should set completedAt when processing fails", () => {
    const simulation = createSimulation();
    const runtime = new SimulationRuntime(simulation);
    const processEvent = vi.fn(() => {
      throw new Error("Processing failed");
    });
    const engine = new SimulationEngine(runtime, { process: processEvent });

    engine.schedule(createEvent("event-a", 100));

    expect(() => engine.run()).toThrow("Processing failed");
    expect(runtime.simulation.status).toBe("failed");
    expect(runtime.simulation.completedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(runtime.simulation.completedAt?.getTime())).toBe(false);
  });

  it("should record startedAt before completedAt", () => {
    vi.useFakeTimers();

    try {
      const simulation = createSimulation();
      const runtime = new SimulationRuntime(simulation);
      const processEvent = vi.fn().mockImplementation(() => {
        vi.advanceTimersByTime(5);
      });
      const engine = new SimulationEngine(runtime, { process: processEvent });

      engine.schedule(createEvent("event-a", 100));
      engine.run();

      expect(simulation.startedAt.getTime()).toBeLessThan(
        simulation.completedAt!.getTime(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("should set startedAt and completedAt for an empty simulation", () => {
    const { simulation, engine } = createFixture();

    engine.run();

    expect(simulation.startedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(simulation.startedAt.getTime())).toBe(false);
    expect(simulation.completedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(simulation.completedAt?.getTime())).toBe(false);
  });
});
