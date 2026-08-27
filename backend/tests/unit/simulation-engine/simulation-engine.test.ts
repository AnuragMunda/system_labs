import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/runtime/simulation-runtime.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { describe, expect, it, vi } from "vitest";

function createEvent(id: string, timestampMs: number): SimulationEvent {
  return {
    id,
    simulationId: "simulation-1",
    timestampMs,
    type: "request.created",
  };
}

function createSimulation(): Simulation {
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
    seed: 42,
    architectureSnapshot: { nodes: [], edges: [] },
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createFixture() {
  const simulation = createSimulation();
  const runtime = new SimulationRuntime(simulation);
  const processEvent = vi.fn();
  const engine = new SimulationEngine(runtime, processEvent);

  return { simulation, runtime, engine, processEvent };
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
});

describe("SimulationEngine", () => {
  it("should advance the runtime clock to a single event's timestamp", () => {
    const { runtime, engine, processEvent } = createFixture();

    engine.schedule(createEvent("event-a", 100));

    engine.run();

    expect(processEvent).toHaveBeenCalledTimes(1);
    expect(runtime.currentTimeMs).toBe(100);
  });

  it("should process unordered events in timestamp order and end at the latest", () => {
    const { runtime, engine, processEvent } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 20));
    engine.schedule(createEvent("event-c", 50));

    engine.run();

    const processedTimes = processEvent.mock.calls.map(
      ([event]) => event.timestampMs,
    );

    expect(processedTimes).toEqual([20, 50, 100]);
    expect(runtime.currentTimeMs).toBe(100);
  });

  it("should process already-ordered events without reordering", () => {
    const { runtime, engine, processEvent } = createFixture();

    engine.schedule(createEvent("event-1", 10));
    engine.schedule(createEvent("event-2", 20));
    engine.schedule(createEvent("event-3", 30));

    engine.run();

    const processedTimes = processEvent.mock.calls.map(
      ([event]) => event.timestampMs,
    );

    expect(processedTimes).toEqual([10, 20, 30]);
    expect(runtime.currentTimeMs).toBe(30);
  });

  it("should never move the clock backwards while processing events", () => {
    const { runtime, engine, processEvent } = createFixture();

    const processedTimes: number[] = [];

    processEvent.mockImplementation(() => {
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
