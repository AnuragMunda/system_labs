import { TrafficGenerator } from "@/simulation-engine/core/traffic-generator.js";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { describe, expect, it, vi } from "vitest";

function createSimulation(config: Simulation["config"]): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "running",
    config,
    currentTimeMs: 0,
    seed: 42,
    architectureSnapshot: { nodes: [], edges: [] },
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function setup(
  config: Simulation["config"],
  sourceNodeId = "client",
): {
  runtime: SimulationRuntime;
  generator: TrafficGenerator;
  sourceNodeId: string;
} {
  const runtime = new SimulationRuntime(createSimulation(config));
  const engine = new SimulationEngine(runtime, { process: vi.fn() });
  const generator = new TrafficGenerator(runtime, engine);

  return { runtime, generator, sourceNodeId };
}

function drainEvents(runtime: SimulationRuntime): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  while (!runtime.eventQueue.isEmpty()) {
    const event = runtime.eventQueue.dequeue();

    if (event) {
      events.push(event);
    }
  }

  return events;
}

describe("TrafficGenerator", () => {
  it("should generate 100 requests at 10ms intervals for 100 req/s over 1000ms", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 1000,
      requestsPerSecond: 100,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(100);
    expect(events.map((event) => event.timestampMs)).toEqual(
      Array.from({ length: 100 }, (_, i) => i * 10),
    );
  });

  it("should generate 5 requests at 100ms intervals for 10 req/s over 500ms", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 500,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(5);
    expect(events.map((event) => event.timestampMs)).toEqual([
      0, 100, 200, 300, 400,
    ]);
  });

  it("should generate 3 requests for a fractional rate of 3 req/s over 1000ms", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 1000,
      requestsPerSecond: 3,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    // 1000ms is the exclusive endpoint — a fourth arrival is not emitted.
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.timestampMs)).toEqual([0, 333, 667]);
  });

  it("should generate no requests or events when the rate is zero", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 1000,
      requestsPerSecond: 0,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(0);
  });

  it("should generate no requests or events when the duration is zero", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 0,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(0);
  });

  it("should allow multiple requests to share the same timestamp", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 5,
      requestsPerSecond: 10000,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    // 0.1ms interval — 5 arrivals round down to t = 0.
    const atTimeZero = events.filter((event) => event.timestampMs === 0);

    expect(atTimeZero).toHaveLength(5);
  });

  it("should not force timestamps to be unique", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 5,
      requestsPerSecond: 10000,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);
    const timestamps = events.map((event) => event.timestampMs);

    expect(new Set(timestamps).size).toBeLessThan(timestamps.length);
  });

  it("should generate no requests or events when the rate is negative", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 1000,
      requestsPerSecond: -5,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(0);
  });

  it("should generate no requests or events when the duration is negative", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: -1,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events).toHaveLength(0);
  });

  it("should tag every generated event with the source node", () => {
    const { runtime, generator } = setup(
      {
        durationMs: 1000,
        requestsPerSecond: 10,
        simulationSpeed: 1,
        collectMetrics: true,
        emitEvents: true,
      },
      "load-balancer",
    );

    generator.generate("load-balancer");

    const events = drainEvents(runtime);

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.sourceNodeId).toBe("load-balancer");
    }
  });

  it("should create a matching request for every generated event", () => {
    const { runtime, generator, sourceNodeId } = setup({
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    });

    generator.generate(sourceNodeId);

    const events = drainEvents(runtime);

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      const requestId = event.payload?.requestId;

      expect(typeof requestId).toBe("string");

      const request = runtime.getRequest(requestId as string);

      expect(request.createdAtMs).toBe(event.timestampMs);
    }
  });
});
