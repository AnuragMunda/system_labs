import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { RoundRobinStrategy } from "@/simulation-engine/routing/round-robin-strategy.js";
import { RandomStrategy } from "@/simulation-engine/routing/random-strategy.js";
import { LeastConnectionsStrategy } from "@/simulation-engine/routing/least-connections-strategy.js";
import { RoutingStrategyType } from "@/domain/architecture/component.types.js";
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
  const engine = new SimulationEngine(
    runtime,
    eventProcessor,
    new TrafficGenerator(runtime),
    new FailureScheduler(runtime),
    new AutoscalingScheduler(runtime),
  );

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

  it.each<RoutingStrategyType>(["round_robin", "random", "least_connections"])(
    "should initialize the %s routing strategy from the node config",
    (strategyType) => {
      const graph: ArchitectureGraph = {
        nodes: [
          {
            id: "lb",
            type: "load_balancer",
            name: "lb",
            position: { x: 0, y: 0 },
            config: { routingStrategy: strategyType },
          },
        ],
        edges: [],
      };

      const runtime = new SimulationRuntime(
        createSimulation({ architectureSnapshot: graph }),
      );

      const strategy = runtime.getRoutingStrategy("lb");

      switch (strategyType) {
        case "round_robin":
          expect(strategy).toBeInstanceOf(RoundRobinStrategy);
          break;
        case "random":
          expect(strategy).toBeInstanceOf(RandomStrategy);
          break;
        case "least_connections":
          expect(strategy).toBeInstanceOf(LeastConnectionsStrategy);
          break;
      }
    },
  );

  it("should throw when no routing strategy is configured for a node", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        {
          id: "lb",
          type: "load_balancer",
          name: "lb",
          position: { x: 0, y: 0 },
          config: {},
        },
      ],
      edges: [],
    };

    const runtime = new SimulationRuntime(
      createSimulation({ architectureSnapshot: graph }),
    );

    expect(() => runtime.getRoutingStrategy("lb")).toThrow(
      "Routing strategy not configured for node: lb",
    );
  });

  describe("health evaluation bookkeeping", () => {
    it("should initialize processing counters and effective concurrency", () => {
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

      const component = runtime.getComponent("api");

      expect(component.totalProcessingAttempts).toBe(0);
      expect(component.failedProcessingAttempts).toBe(0);
      expect(component.totalProcessingLatencyMs).toBe(0);
      expect(component.lastProcessingLatencyMs).toBeUndefined();
      expect(component.effectiveConcurrency).toBe(4);
    });

    it("should record processing attempts and failures", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      runtime.recordProcessingAttempt("api");
      runtime.recordProcessingAttempt("api");
      runtime.recordProcessingFailure("api");

      expect(runtime.getComponent("api").totalProcessingAttempts).toBe(2);
      expect(runtime.getComponent("api").failedProcessingAttempts).toBe(1);
    });

    it("should record processing latency cumulatively and as the latest value", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      runtime.recordProcessingLatency("api", 25);
      runtime.recordProcessingLatency("api", 35);
      runtime.recordProcessingLatency("api", 40);

      expect(runtime.getComponent("api").totalProcessingLatencyMs).toBe(100);
      expect(runtime.getComponent("api").lastProcessingLatencyMs).toBe(40);
    });

    it("should throw when processing latency is negative", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      expect(() => runtime.recordProcessingLatency("api", -1)).toThrow(
        "Processing latency cannot be negative: -1",
      );
    });
  });

  describe("evaluateComponentHealth", () => {
    it("should leave an explicitly failed component failed", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      runtime.updateComponent("api", {
        health: "failed",
        totalProcessingAttempts: 100,
        failedProcessingAttempts: 100,
      });

      runtime.evaluateComponentHealth("api");

      expect(runtime.getComponent("api").health).toBe("failed");
    });

    it("should return no transition for an already failed component", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      runtime.updateComponent("api", {
        health: "failed",
        activeRequests: 8,
        effectiveConcurrency: 10,
        failedProcessingAttempts: 100,
        totalProcessingAttempts: 100,
      });

      const transition = runtime.evaluateComponentHealth("api");

      // Automatic health evaluation never mutates an explicitly failed
      // component, so no transition is reported.
      expect(transition).toBeUndefined();

      expect(runtime.getComponent("api").health).toBe("failed");
    });

    it("should return a transition when health actually changes", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      // Default effective concurrency is 1, so a single active request gives
      // utilization 1.0 → critical (≥ 0.9).
      runtime.incrementActiveRequests("api");

      const transition = runtime.evaluateComponentHealth("api");

      expect(transition).toEqual({
        previousHealth: "healthy",
        health: "critical",
      });

      expect(runtime.getComponent("api").health).toBe("critical");
    });

    it("should return no transition when health is unchanged", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      expect(runtime.evaluateComponentHealth("api")).toBeUndefined();
    });

    it("should use node-specific health thresholds when configured", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          {
            id: "api",
            type: "api",
            name: "api",
            position: { x: 0, y: 0 },
            config: {
              healthThresholds: {
                utilization: { degraded: 0.2, critical: 0.5 },
                errorRate: { degraded: 0.05, critical: 0.2 },
                latencyMs: { degraded: 200, critical: 500 },
              },
            },
          },
        ],
        edges: [],
      };

      const runtime = new SimulationRuntime(
        createSimulation({ architectureSnapshot: graph }),
      );

      // 1 active request on effectiveConcurrency 1 → utilization 1.0 ≥ 0.5.
      runtime.incrementActiveRequests("api");
      runtime.evaluateComponentHealth("api");

      expect(runtime.getComponent("api").health).toBe("critical");
    });

    it("should fall back to default thresholds and report degraded health", () => {
      const runtime = new SimulationRuntime(
        createSimulation({
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
          },
        }),
      );

      // High utilization without custom thresholds → degraded, not critical.
      runtime.updateComponent("api", {
        activeRequests: 8,
        effectiveConcurrency: 10,
      });

      runtime.evaluateComponentHealth("api");

      expect(runtime.getComponent("api").health).toBe("degraded");
    });

    it("should throw when the node does not exist", () => {
      const runtime = new SimulationRuntime(createSimulation());

      expect(() => runtime.evaluateComponentHealth("missing")).toThrow(
        "Component not found: missing",
      );
    });
  });

  describe("recovery cycles", () => {
    const apiGraph: ArchitectureGraph = {
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

    function createApiRuntime(): SimulationRuntime {
      return new SimulationRuntime(
        createSimulation({ architectureSnapshot: apiGraph }),
      );
    }

    it("should start recovery generation at 0", () => {
      const runtime = createApiRuntime();

      expect(runtime.getComponent("api").recoveryGeneration).toBe(0);
      expect(runtime.getRecoveryGeneration("api")).toBe(0);
    });

    it("should increment the recovery generation on each new recovery cycle", () => {
      const runtime = createApiRuntime();

      expect(runtime.startRecoveryCycle("api")).toBe(1);
      expect(runtime.startRecoveryCycle("api")).toBe(2);

      expect(runtime.getRecoveryGeneration("api")).toBe(2);
    });

    it("should restore health and recovery generation on reset", () => {
      const runtime = createApiRuntime();

      runtime.setComponentHealth("api", "failed");
      runtime.startRecoveryCycle("api");

      expect(runtime.getComponent("api").health).toBe("failed");
      expect(runtime.getRecoveryGeneration("api")).toBe(1);

      runtime.reset();

      expect(runtime.getComponent("api").health).toBe("healthy");
      expect(runtime.getRecoveryGeneration("api")).toBe(0);
    });
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

  it("should throw when a completed simulation is started again", () => {
    const { engine } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(() => engine.run()).toThrow(
      "Simulation cannot be started from status completed",
    );
  });

  it("should throw when a failed simulation is started", () => {
    const simulation = createSimulation({ status: "failed" });
    const runtime = new SimulationRuntime(simulation);
    const engine = new SimulationEngine(
      runtime,
      { process: vi.fn() },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    expect(() => engine.run()).toThrow(
      "Simulation cannot be started from status failed",
    );
  });

  it("should throw when a cancelled simulation is started", () => {
    const simulation = createSimulation({ status: "cancelled" });
    const runtime = new SimulationRuntime(simulation);
    const engine = new SimulationEngine(
      runtime,
      { process: vi.fn() },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    expect(() => engine.run()).toThrow(
      "Simulation cannot be started from status cancelled",
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
    const engine = new SimulationEngine(
      runtime,
      { process: processEvent },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

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
    const engine = new SimulationEngine(
      runtime,
      { process: processEvent },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

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
    const engine = new SimulationEngine(
      runtime,
      { process: processEvent },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    engine.schedule(createEvent("event-a", 100));

    expect(() => engine.run()).toThrow("Processing failed");

    expect(() => engine.run()).toThrow(
      "Simulation cannot be started from status failed",
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
    const engine = new SimulationEngine(
      runtime,
      { process: processEvent },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

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
      const engine = new SimulationEngine(
        runtime,
        { process: processEvent },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

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

  it("should advance the clock one event per step", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));
    engine.schedule(createEvent("event-c", 300));

    engine.step();

    expect(runtime.clock.now()).toBe(100);

    engine.step();

    expect(runtime.clock.now()).toBe(200);
  });

  it("should process only a single event per step", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));
    engine.schedule(createEvent("event-c", 300));

    engine.step();

    expect(eventProcessor.process).toHaveBeenCalledTimes(1);
    expect(runtime.clock.now()).toBe(100);
    expect(runtime.eventQueue.size()).toBe(2);
  });

  it("should return false when no event is eligible", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    expect(engine.step()).toBe(false);
  });

  it("should return true when an event is processed", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 100));

    expect(engine.step()).toBe(true);
  });

  it("should not process events at or beyond the configured duration", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 1000));

    expect(engine.step()).toBe(false);
    expect(runtime.clock.now()).toBe(0);
  });

  it("should throw when stepping a created simulation", () => {
    const { engine } = createFixture();

    expect(() => engine.step()).toThrow(
      "Simulation cannot be stepped from status created",
    );
  });

  it("should throw when stepping a completed simulation", () => {
    const { engine } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.run();

    expect(() => engine.step()).toThrow(
      "Simulation cannot be stepped from status completed",
    );
  });

  it("should throw when stepping a failed simulation", () => {
    const simulation = createSimulation();
    const runtime = new SimulationRuntime(simulation);
    const processEvent = vi.fn(() => {
      throw new Error("Processing failed");
    });
    const engine = new SimulationEngine(
      runtime,
      { process: processEvent },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    engine.schedule(createEvent("event-a", 100));

    expect(() => engine.run()).toThrow("Processing failed");

    expect(() => engine.step()).toThrow(
      "Simulation cannot be stepped from status failed",
    );
  });

  it("should report no pending events when the queue is empty", () => {
    const { engine } = createFixture();

    expect(engine.hasPendingEvents()).toBe(false);
  });

  it("should report pending events for an eligible event", () => {
    const { engine } = createFixture();

    engine.schedule(createEvent("event-a", 500));

    expect(engine.hasPendingEvents()).toBe(true);
  });

  it("should report no pending events for an event at the duration boundary", () => {
    const { engine } = createFixture();

    engine.schedule(createEvent("event-a", 1000));

    expect(engine.hasPendingEvents()).toBe(false);
  });

  it("should report no pending events for an event after the duration boundary", () => {
    const { engine } = createFixture();

    engine.schedule(createEvent("event-a", 1500));

    expect(engine.hasPendingEvents()).toBe(false);
  });

  it("should only consider the earliest event when deciding if processing remains", () => {
    const { runtime, engine } = createFixture();

    engine.schedule(createEvent("event-a", 500));
    engine.schedule(createEvent("event-b", 1000));
    engine.schedule(createEvent("event-c", 1500));

    expect(engine.hasPendingEvents()).toBe(true);

    runtime.simulation.status = "running";

    engine.step();

    expect(engine.hasPendingEvents()).toBe(false);
  });

  it("should complete the simulation when stepping its final event", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 500));

    expect(engine.step()).toBe(true);
    expect(runtime.simulation.status).toBe("completed");
  });

  it("should complete a boundary-only queue without processing anything", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 1000));

    expect(engine.step()).toBe(false);
    expect(eventProcessor.process).not.toHaveBeenCalled();
    expect(runtime.simulation.status).toBe("completed");
  });

  it("should stay running while further events remain", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));

    engine.step();

    expect(runtime.simulation.status).toBe("running");

    engine.step();

    expect(runtime.simulation.status).toBe("completed");
  });

  it("should set completedAt when the final event completes the simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 500));

    engine.step();

    expect(runtime.simulation.completedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(runtime.simulation.completedAt?.getTime())).toBe(false);
  });

  it("should pause a running simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.pause();

    expect(runtime.simulation.status).toBe("paused");
  });

  it("should resume a paused simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.pause();

    expect(runtime.simulation.status).toBe("paused");

    engine.resume();

    expect(runtime.simulation.status).toBe("running");
  });

  it("should cancel a running simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.cancel();

    expect(runtime.simulation.status).toBe("cancelled");
  });

  it("should cancel a paused simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.pause();
    engine.cancel();

    expect(runtime.simulation.status).toBe("cancelled");
  });

  it.each(["created", "completed", "failed", "cancelled", "paused"] as const)(
    "should throw when pausing a %s simulation",
    (status) => {
      const simulation = createSimulation({ status });
      const runtime = new SimulationRuntime(simulation);
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      expect(() => engine.pause()).toThrow(
        `Simulation cannot be paused from status ${status}`,
      );
    },
  );

  it.each(["created", "running", "completed", "failed", "cancelled"] as const)(
    "should throw when resuming a %s simulation",
    (status) => {
      const simulation = createSimulation({ status });
      const runtime = new SimulationRuntime(simulation);
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      expect(() => engine.resume()).toThrow(
        `Simulation cannot be resumed from status ${status}`,
      );
    },
  );

  it.each(["created", "completed", "failed", "cancelled"] as const)(
    "should throw when cancelling a %s simulation",
    (status) => {
      const simulation = createSimulation({ status });
      const runtime = new SimulationRuntime(simulation);
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      expect(() => engine.cancel()).toThrow(
        `Simulation cannot be cancelled from status ${status}`,
      );
    },
  );

  it("should throw when stepping a paused simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.pause();

    expect(() => engine.step()).toThrow(
      "Simulation cannot be stepped from status paused",
    );
  });

  it("should throw when stepping a cancelled simulation", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.cancel();

    expect(() => engine.step()).toThrow(
      "Simulation cannot be stepped from status cancelled",
    );
  });

  it("should record completedAt when cancelled from running", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.cancel();

    expect(runtime.simulation.completedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(runtime.simulation.completedAt?.getTime())).toBe(false);
  });

  it("should record completedAt when cancelled from paused", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.pause();
    engine.cancel();

    expect(runtime.simulation.completedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(runtime.simulation.completedAt?.getTime())).toBe(false);
  });

  it("should preserve the event queue when a simulation is paused", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));

    engine.pause();

    expect(runtime.eventQueue.size()).toBe(2);
  });

  it("should preserve the event queue when a simulation is cancelled", () => {
    const { runtime, engine } = createFixture();

    runtime.simulation.status = "running";

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));

    engine.cancel();

    expect(runtime.eventQueue.size()).toBe(2);
    expect(runtime.eventQueue.peek()?.timestampMs).toBe(100);
  });

  it("should start a created simulation", () => {
    const { runtime, engine } = createFixture();

    engine.start();

    expect(runtime.simulation.status).toBe("running");
  });

  it("should set startedAt when a simulation starts", () => {
    const { runtime, engine } = createFixture();

    engine.start();

    expect(runtime.simulation.startedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(runtime.simulation.startedAt.getTime())).toBe(false);
  });

  it.each(["running", "paused", "completed", "failed", "cancelled"] as const)(
    "should throw when starting a %s simulation",
    (status) => {
      const simulation = createSimulation({ status });
      const runtime = new SimulationRuntime(simulation);
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      expect(() => engine.start()).toThrow(
        `Simulation cannot be started from status ${status}`,
      );
    },
  );

  it("should not process events when starting", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));

    engine.start();

    expect(eventProcessor.process).not.toHaveBeenCalled();
    expect(runtime.eventQueue.size()).toBe(2);
  });

  it("should process only eligible events when running", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));
    engine.schedule(createEvent("event-c", 1500));

    engine.run();

    const processedTimes = eventProcessor.process.mock.calls.map(
      ([event]) => event.timestampMs,
    );

    expect(processedTimes).toEqual([100, 200]);
    expect(runtime.simulation.status).toBe("completed");
  });

  it("should execute every event that shares the same timestamp", () => {
    const { engine, eventProcessor } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 100));
    engine.schedule(createEvent("event-c", 100));

    engine.run();

    const processedIds = eventProcessor.process.mock.calls.map(
      ([event]) => event.id,
    );

    expect(processedIds).toEqual(["event-a", "event-b", "event-c"]);
  });

  it("should execute events scheduled dynamically during processing", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    let scheduled = false;

    eventProcessor.process.mockImplementation((event) => {
      if (!scheduled) {
        scheduled = true;
        runtime.schedule(
          createEvent("event-scheduled-" + event.id, event.timestampMs + 150),
        );
      }
    });

    engine.schedule(createEvent("event-a", 100));

    engine.run();

    const processedIds = eventProcessor.process.mock.calls.map(
      ([event]) => event.id,
    );

    expect(processedIds).toEqual(["event-a", "event-scheduled-event-a"]);
  });

  it("should insert dynamically scheduled events in timestamp order", () => {
    const { runtime, engine, eventProcessor } = createFixture();

    eventProcessor.process.mockImplementation((event) => {
      if (event.id === "event-a") {
        runtime.schedule(createEvent("event-c", 150));
      }
    });

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));

    engine.run();

    const processedTimes = eventProcessor.process.mock.calls.map(
      ([event]) => event.timestampMs,
    );

    expect(processedTimes).toEqual([100, 150, 200]);
  });

  it("should fail the simulation when an event is scheduled in the past", () => {
    const runtime = new SimulationRuntime(createSimulation());
    const processEvent = vi.fn().mockImplementation(() => {
      runtime.schedule(createEvent("event-past", 50));
    });
    const engine = new SimulationEngine(
      runtime,
      { process: processEvent },
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    engine.schedule(createEvent("event-a", 100));

    expect(() => engine.run()).toThrow(
      "Timestamp must be greater than current time.",
    );
    expect(runtime.simulation.status).toBe("failed");
  });

  it("should leave out-of-bound events in the queue after running", () => {
    const { runtime, engine } = createFixture();

    engine.schedule(createEvent("event-a", 100));
    engine.schedule(createEvent("event-b", 200));
    engine.schedule(createEvent("event-c", 1000));
    engine.schedule(createEvent("event-d", 1500));

    engine.run();

    expect(runtime.simulation.status).toBe("completed");
    expect(runtime.eventQueue.size()).toBe(2);
    expect(runtime.eventQueue.peek()?.timestampMs).toBe(1000);
  });

  describe("initializeTraffic", () => {
    it("should populate traffic without changing status or advancing the clock", () => {
      const runtime = new SimulationRuntime(createSimulation());
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      engine.initializeTraffic("client");

      expect(runtime.simulation.status).toBe("created");
      expect(runtime.clock.now()).toBe(0);
    });

    it("should populate the runtime requests and event queue", () => {
      const runtime = new SimulationRuntime(createSimulation());
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      engine.initializeTraffic("client");

      expect(runtime.eventQueue.size()).toBe(10);

      const firstEvent = runtime.eventQueue.peek();
      expect(firstEvent?.id).toBe("simulation-1:event:request-created:0");
      expect(firstEvent?.type).toBe("request.created");
      expect(firstEvent?.sourceNodeId).toBe("client");

      for (let i = 0; i < 10; i++) {
        expect(runtime.getRequest(`simulation-1:request:${i}`)).toBeDefined();
      }
    });

    it("should process the first generated event after start and step", () => {
      const runtime = new SimulationRuntime(createSimulation());
      const eventProcessor = { process: vi.fn() };
      const engine = new SimulationEngine(
        runtime,
        eventProcessor,
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      engine.initializeTraffic("client");

      engine.start();
      engine.step();

      expect(eventProcessor.process).toHaveBeenCalledWith(
        expect.objectContaining({ id: "simulation-1:event:request-created:0" }),
      );
      expect(runtime.clock.now()).toBe(0);
      expect(runtime.simulation.status).toBe("running");
      expect(runtime.eventQueue.size()).toBe(9);
    });

    it.each(["running", "paused", "completed", "failed", "cancelled"])(
      "should throw when traffic is initialized from status %s",
      (status) => {
        const runtime = new SimulationRuntime(createSimulation({ status }));
        const engine = new SimulationEngine(
          runtime,
          { process: vi.fn() },
          new TrafficGenerator(runtime),
          new FailureScheduler(runtime),
          new AutoscalingScheduler(runtime),
        );

        expect(() => engine.initializeTraffic("client")).toThrow(
          `Traffic cannot be initialized from status ${status}`,
        );
      },
    );
  });

  describe("initializeFailures", () => {
    it("should queue failure events without changing status or advancing the clock", () => {
      const simulation = createSimulation({
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
        },
      });
      simulation.config = {
        ...simulation.config,
        // Recovery is config-driven (recoveryDelayMs); failures only schedule
        // the initial component.failed event.
        failures: [{ nodeId: "api", failedAtMs: 50 }],
      };

      const runtime = new SimulationRuntime(simulation);
      const engine = new SimulationEngine(
        runtime,
        { process: vi.fn() },
        new TrafficGenerator(runtime),
        new FailureScheduler(runtime),
        new AutoscalingScheduler(runtime),
      );

      engine.initializeFailures();

      expect(runtime.simulation.status).toBe("created");
      expect(runtime.clock.now()).toBe(0);
      expect(runtime.eventQueue.size()).toBe(1);

      const failed = runtime.eventQueue.dequeue();

      expect(failed).toMatchObject({
        type: "component.failed",
        timestampMs: 50,
        sourceNodeId: "api",
      });
    });

    it.each(["running", "paused", "completed", "failed", "cancelled"])(
      "should throw when failures are initialized from status %s",
      (status) => {
        const runtime = new SimulationRuntime(createSimulation({ status }));
        const engine = new SimulationEngine(
          runtime,
          { process: vi.fn() },
          new TrafficGenerator(runtime),
          new FailureScheduler(runtime),
          new AutoscalingScheduler(runtime),
        );

        expect(() => engine.initializeFailures()).toThrow(
          `Failures cannot be initialized from status ${status}`,
        );
      },
    );
  });
});
