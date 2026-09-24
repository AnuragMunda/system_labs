import { describe, expect, it } from "vitest";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import type { EventProcessor } from "@/simulation-engine/utils/types.js";
import type { Simulation } from "@/domain/simulation/simulation.types.js";
import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type { ArchitectureNode } from "@/domain/architecture/component.types.js";
import type { AutoscalingConfig } from "@/domain/architecture/component.types.js";

function node(
  id: string,
  type: ArchitectureNode["type"],
  config: ArchitectureNode["config"] = {},
): ArchitectureNode {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    config,
  };
}

function autoscaling(
  overrides: Partial<AutoscalingConfig> = {},
): AutoscalingConfig {
  return {
    enabled: true,
    min: 1,
    max: 10,
    targetCpu: 50,
    ...overrides,
  };
}

function createSimulation(
  graph: ArchitectureGraph,
  overrides: { durationMs?: number; seed?: number } = {},
): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: overrides.durationMs ?? 5000,
      requestsPerSecond: 2000,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    currentTimeMs: 0,
    seed: overrides.seed ?? 42,
    architectureSnapshot: graph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
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

// Builds a ready-made component.scaled event for direct processor feeds. The
// controller normally captures previousReplicas when it schedules the event;
// here it is simplified to replicas - 1.
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

function createRuntime(
  nodes: ArchitectureNode[],
  overrides: { durationMs?: number; seed?: number } = {},
) {
  const runtime = new SimulationRuntime(
    createSimulation({ nodes, edges: [] }, overrides),
  );
  const controller = new AutoscalingController(runtime);
  const scheduler = new AutoscalingScheduler(runtime);
  const processor = new DefaultEventProcessor(runtime, controller, scheduler);

  return { runtime, processor, controller, scheduler };
}

describe("AutoscalingScheduler", () => {
  it("should schedule the first evaluation for every autoscaling-enabled component", () => {
    const { runtime } = createRuntime([
      node("api", "api", { autoscaling: autoscaling() }),
      node("cache", "cache", { autoscaling: autoscaling() }),
      node("db", "database", {}),
    ]);

    new AutoscalingScheduler(runtime).schedule();

    const events = drainEvents(runtime);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.type).toBe("autoscaling.evaluate");
      expect(event.timestampMs).toBe(1000);
    }
    expect(events.map((event) => event.sourceNodeId).sort()).toEqual([
      "api",
      "cache",
    ]);
  });

  it("should not schedule evaluations when the duration does not exceed the interval", () => {
    const { runtime } = createRuntime(
      [node("api", "api", { autoscaling: autoscaling() })],
      {
        durationMs: 1000,
      },
    );

    new AutoscalingScheduler(runtime).schedule();

    expect(drainEvents(runtime)).toEqual([]);
  });

  it("should schedule the first evaluation at the configured interval", () => {
    const { runtime } = createRuntime(
      [node("api", "api", { autoscaling: autoscaling() })],
      {
        durationMs: 5000,
      },
    );

    new AutoscalingScheduler(runtime, 600).schedule();

    const events = drainEvents(runtime);
    expect(events).toHaveLength(1);
    expect(events[0]?.timestampMs).toBe(600);
  });

  it("should throw when the evaluation interval is not positive", () => {
    const { runtime } = createRuntime(
      [node("api", "api", { autoscaling: autoscaling() })],
      {
        durationMs: 5000,
      },
    );

    expect(() => new AutoscalingScheduler(runtime, 0).schedule()).toThrow(
      /must be positive/,
    );
  });

  it("should schedule the next evaluation at interval after the current evaluation", () => {
    const { runtime } = createRuntime(
      [node("api", "api", { autoscaling: autoscaling() })],
      {
        durationMs: 5000,
      },
    );

    const scheduler = new AutoscalingScheduler(runtime);
    scheduler.scheduleNext("api", 1000);

    const events = drainEvents(runtime);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("autoscaling.evaluate");
    expect(events[0]?.timestampMs).toBe(2000);
    expect(events[0]?.sourceNodeId).toBe("api");
  });

  it("should not schedule the next evaluation at or beyond the duration", () => {
    const { runtime } = createRuntime(
      [node("api", "api", { autoscaling: autoscaling() })],
      {
        durationMs: 3000,
      },
    );

    const scheduler = new AutoscalingScheduler(runtime);
    scheduler.scheduleNext("api", 2000);

    expect(drainEvents(runtime)).toEqual([]);
  });
});

describe("DefaultEventProcessor autoscaling events", () => {
  it("should evaluate a component and schedule its next evaluation", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    runtime.updateComponent("api", { activeRequests: 7 });
    processor.process(evaluateEvent("api", 1000));

    const events = drainEvents(runtime);
    const scaled = events.find((event) => event.type === "component.scaled");
    const next = events.find(
      (event) =>
        event.type === "autoscaling.evaluate" && event.timestampMs === 2000,
    );

    expect(scaled?.timestampMs).toBe(1000);
    expect(scaled?.payload?.previousReplicas).toBe(2);
    expect(scaled?.payload?.replicas).toBe(3);
    expect(next).toBeDefined();

    expect(runtime.getComponent("api").replicas).toBe(2);
  });

  it("should apply a component.scaled decision to the component state", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    processor.process(scaledEvent("api", 1000, 3));

    const component = runtime.getComponent("api");
    expect(component.replicas).toBe(3);
    expect(component.effectiveConcurrency).toBe(15);
    expect(runtime.getEffectiveConcurrency("api")).toBe(15);
    expect(runtime.hasCapacity("api")).toBe(true);
  });

  it("should grow capacity when an evaluation and its scaling event both run", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 1,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    runtime.updateComponent("api", { activeRequests: 2 });
    expect(runtime.hasCapacity("api")).toBe(false);

    processor.process(evaluateEvent("api", 1000));
    const scaled = drainEvents(runtime).find(
      (event) => event.type === "component.scaled",
    );
    expect(scaled?.payload?.replicas).toBe(3);

    processor.process(scaled!);
    expect(runtime.getComponent("api").replicas).toBe(3);
    expect(runtime.hasCapacity("api")).toBe(true);
  });

  it("should ignore a component.scaled event for an autoscaling-disabled component", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ enabled: false }),
        }),
      ],
      { durationMs: 5000 },
    );

    processor.process(scaledEvent("api", 1000, 3));

    const component = runtime.getComponent("api");
    expect(component.replicas).toBe(2);
    expect(component.effectiveConcurrency).toBe(10);
  });

  it("should ignore a component.scaled event for a failed component", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    runtime.setComponentHealth("api", "failed");
    processor.process(scaledEvent("api", 1000, 3));

    expect(runtime.getComponent("api").replicas).toBe(2);
    expect(runtime.getComponent("api").health).toBe("failed");
  });

  it("should reject a component.scaled event with a non-positive replicas value", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    expect(() => processor.process(scaledEvent("api", 1000, 0))).toThrow(
      /positive integer/,
    );
    expect(() => processor.process(scaledEvent("api", 1000, 2.5))).toThrow(
      /positive integer/,
    );
    expect(runtime.getComponent("api").replicas).toBe(2);
  });

  it("should reject a component.scaled event outside the autoscaling bounds", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 4 }),
        }),
      ],
      { durationMs: 5000 },
    );

    expect(() => processor.process(scaledEvent("api", 1000, 5))).toThrow(
      /outside autoscaling bounds/,
    );
    expect(runtime.getComponent("api").replicas).toBe(2);
  });

  it("should require a component.scaled event to carry a sourceNodeId", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    const missingSource: SimulationEvent = {
      id: "event-no-source",
      simulationId: "simulation-1",
      timestampMs: 1000,
      type: "component.scaled",
      payload: { replicas: 3 },
    };

    expect(() => processor.process(missingSource)).toThrow(/sourceNodeId/);
    expect(runtime.getComponent("api").replicas).toBe(2);
  });

  it("should schedule a queue.drain on a scale-up when requests are queued", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
          queue: { maxSize: 10 },
        }),
      ],
      { durationMs: 5000 },
    );

    runtime.enqueueRequest("api", "req-1");

    processor.process(scaledEvent("api", 1000, 3));

    const events = drainEvents(runtime);
    const drain = events.find((event) => event.type === "queue.drain");

    expect(drain).toBeDefined();
    expect(drain?.sourceNodeId).toBe("api");
    expect(drain?.timestampMs).toBe(1000);

    expect(runtime.getComponent("api").replicas).toBe(3);
  });

  it("should not schedule a queue.drain on a scale-up when nothing is queued", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ],
      { durationMs: 5000 },
    );

    processor.process(scaledEvent("api", 1000, 3));

    const events = drainEvents(runtime);

    expect(events.some((event) => event.type === "queue.drain")).toBe(false);
  });

  it("should not schedule a queue.drain on a scale-down even when requests are queued", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 3,
          concurrency: 5,
          autoscaling: autoscaling(),
          queue: { maxSize: 10 },
        }),
      ],
      { durationMs: 5000 },
    );

    runtime.enqueueRequest("api", "req-1");

    processor.process(scaledEvent("api", 1000, 2));

    const events = drainEvents(runtime);

    expect(events.some((event) => event.type === "queue.drain")).toBe(false);
    expect(runtime.getComponent("api").replicas).toBe(2);
    expect(runtime.getQueuedRequestCount("api")).toBe(1);
  });

  it("should start queued requests after a scale-up drain", () => {
    const { runtime, processor } = createRuntime(
      [
        node("api", "api", {
          replicas: 2,
          concurrency: 1,
          autoscaling: autoscaling(),
          queue: { maxSize: 10 },
        }),
      ],
      { durationMs: 5000 },
    );

    runtime.enqueueRequest("api", "req-1");
    runtime.enqueueRequest("api", "req-2");

    processor.process(scaledEvent("api", 1000, 3));

    const drain = drainEvents(runtime).find(
      (event) => event.type === "queue.drain",
    );

    expect(drain).toBeDefined();

    processor.process(drain!);

    // The scale-up frees capacity 3*1 = 3, so both queued requests start
    // (FIFO), each preceded by its own queue.dequeue event.
    const drainEventsAfter = drainEvents(runtime)
      .filter(
        (event) =>
          event.type === "queue.dequeue" ||
          event.type === "request.processing_started",
      )
      .map((event) => `${event.type}:${event.payload?.requestId}`);

    expect(drainEventsAfter).toEqual([
      "queue.dequeue:req-1",
      "request.processing_started:req-1",
      "queue.dequeue:req-2",
      "request.processing_started:req-2",
    ]);

    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });
});

describe("SimulationEngine autoscaling", () => {
  function createEngineGraph(): ArchitectureGraph {
    return {
      nodes: [
        node("client", "client", { latencyMs: 0 }),
        node("api", "api", {
          replicas: 2,
          concurrency: 1,
          latencyMs: 100,
          autoscaling: autoscaling({ min: 1, max: 5, targetCpu: 50 }),
        }),
      ],
      edges: [
        {
          id: "edge-client-api",
          source: "client",
          target: "api",
          config: { latencyMs: 0 },
        },
      ],
    };
  }

  function createEngine() {
    const runtime = new SimulationRuntime(
      createSimulation(createEngineGraph(), { durationMs: 5000 }),
    );
    const inner = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    // The engine drains and discards processed events, so capture
    // component.scaled events at the processor boundary to assert on decisions.
    const seen: SimulationEvent[] = [];
    const processor: EventProcessor = {
      process(event: SimulationEvent): void {
        if (event.type === "component.scaled") {
          seen.push(event);
        }
        inner.process(event);
      },
    };
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    return { runtime, engine, seen };
  }

  it("should schedule initial autoscaling evaluations while created", () => {
    const { runtime, engine } = createEngine();

    engine.initializeAutoscaling();

    const events = drainEvents(runtime);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("autoscaling.evaluate");
    expect(events[0]?.sourceNodeId).toBe("api");
    expect(events[0]?.timestampMs).toBe(1000);
  });

  it("should not schedule autoscaling evaluations once the simulation is running", () => {
    const { runtime, engine } = createEngine();

    engine.start();

    expect(() => engine.initializeAutoscaling()).toThrow(/status running/);
    expect(runtime.eventQueue.size()).toBe(0);
  });

  // This heavy end-to-end run processes tens of thousands of events; leave
  // generous headroom for the shared load of the full parallel suite.
  it("should scale a saturated component up to its maximum during a full run", () => {
    const { runtime, engine, seen } = createEngine();

    // 2000 requests/s against 100ms of processing with concurrency 1 keeps the
    // api permanently saturated (utilization 100%), so each evaluation grows it
    // by one — at 1000/2000/3000ms — until the max of 5 is reached.
    engine.initializeTraffic("client");
    engine.initializeFailures();
    engine.initializeAutoscaling();
    engine.run();

    const component = runtime.getComponent("api");
    expect(component.replicas).toBe(5);
    expect(component.effectiveConcurrency).toBe(5);

    const decisions = seen.map((event) => ({
      timestampMs: event.timestampMs,
      previousReplicas: event.payload?.previousReplicas,
      replicas: event.payload?.replicas,
    }));

    expect(decisions).toEqual([
      { timestampMs: 1000, previousReplicas: 2, replicas: 3 },
      { timestampMs: 2000, previousReplicas: 3, replicas: 4 },
      { timestampMs: 3000, previousReplicas: 4, replicas: 5 },
    ]);
  }, 15_000);

  // The same heavy full run as above; keep the same generous headroom.
  it("should produce identical autoscaling decisions for the same seed", () => {
    function decisions() {
      const { engine, seen } = createEngine();

      engine.initializeTraffic("client");
      engine.initializeFailures();
      engine.initializeAutoscaling();
      engine.run();

      // Event ids are randomUUIDs, so determinism is asserted over the
      // decision fields only.
      return seen.map((event) => ({
        timestampMs: event.timestampMs,
        previousReplicas: event.payload?.previousReplicas,
        replicas: event.payload?.replicas,
      }));
    }

    expect(decisions()).toEqual(decisions());
  }, 15_000);
});
