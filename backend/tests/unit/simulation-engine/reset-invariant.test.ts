/**
 * @file reset-invariant.test.ts
 *
 * @description Verifies the reset invariant end to end: a full session run,
 * rewound with `runtime.reset()`, must replay exactly the same simulation a
 * fresh runtime produces from the same seed and inputs — identical event
 * stream, metrics, and request outcomes.
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
import { Simulation } from "@/domain/simulation/simulation.types.js";
import {
  SimulationEvent,
  SimulationEventType,
} from "@/domain/simulation/event.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

function edge(
  source: string,
  target: string,
  config: Record<string, unknown> = {},
) {
  return { id: `${source}-${target}`, source, target, config };
}

/**
 * A deliberately rich graph exercising every stateful corner of the runtime:
 * round-robin routing with two targets, autoscaling, retries with a circuit
 * breaker, automatic recovery, a cache, a database, packet loss, and latency.
 */
function createGraph(): ArchitectureGraph {
  return {
    nodes: [
      node("client", "load_balancer", { routingStrategy: "round_robin" }),
      node("api1", "api", {
        concurrency: 2,
        latencyMs: 5,
        replicas: 1,
        autoscaling: { enabled: true, min: 1, max: 4, targetCpu: 50 },
        retryPolicy: {
          retries: 2,
          circuitBreaker: {
            enabled: true,
            failureThreshold: 5,
            openDurationMs: 200,
          },
        },
        recoveryDelayMs: 150,
      }),
      node("api2", "api", { concurrency: 2, latencyMs: 8, replicas: 1 }),
      node("cache", "cache", {
        cache: { capacity: 8, ttlMs: 500, hitLatencyMs: 2, missLatencyMs: 10 },
      }),
      node("db", "database", { latencyMs: 12, concurrency: 4 }),
    ],
    edges: [
      edge("client", "api1", { latencyMs: 4, packetLossRate: 0.1 }),
      edge("client", "api2", { latencyMs: 7, packetLossRate: 0.05 }),
      edge("api1", "cache", { latencyMs: 2 }),
      edge("api2", "cache", { latencyMs: 3 }),
      edge("cache", "db", { latencyMs: 6, bandwidthMbps: 100 }),
    ],
  };
}

function createSimulation(): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: 2500,
      requestsPerSecond: 40,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
      cacheKeys: ["GET:/users/1", "GET:/users/2", "GET:/users/3"],
      databaseOperations: ["read", "write"],
      failures: [{ nodeId: "api1", failedAtMs: 300 }],
    },
    currentTimeMs: 0,
    seed: 1337,
    architectureSnapshot: createGraph(),
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createSession(runtime: SimulationRuntime): {
  engine: SimulationEngine;
  session: SimulationSession;
} {
  const processor = new DefaultEventProcessor(
    runtime,
    new AutoscalingController(runtime),
    new AutoscalingScheduler(runtime),
  );
  const engine = new SimulationEngine(runtime, processor);

  return {
    engine,
    session: new SimulationSession(
      runtime,
      engine,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    ),
  };
}

/** The externally observable ordering of a run, independent of event ids. */
type EventSignature = { type: SimulationEventType; timestampMs: number };

/**
 * Runs the session to completion while recording every processed event, and
 * asserts the run actually produced a substantial stream before returning it.
 */
function execute(
  session: SimulationSession,
  entryNodeId: string,
): EventSignature[] {
  const processed: EventSignature[] = [];
  const original = DefaultEventProcessor.prototype.process;

  const spy = vi
    .spyOn(DefaultEventProcessor.prototype, "process")
    .mockImplementation(function (event: SimulationEvent) {
      processed.push({ type: event.type, timestampMs: event.timestampMs });
      original.call(this, event);
    });

  try {
    session.run(entryNodeId);
  } finally {
    spy.mockRestore();
  }

  expect(processed.length).toBeGreaterThan(0);

  return processed;
}

/** Terminal request outcomes keyed by request id. */
function requestOutcomes(runtime: SimulationRuntime): Record<string, string> {
  return Object.fromEntries(
    runtime
      .getAllRequests()
      .map((request) => [request.id, `${request.status}:${request.attempts}`]),
  );
}

describe("reset invariant", () => {
  it("run → reset → run reproduces a fresh runtime's run exactly", () => {
    // Run 1 on runtime A.
    const runtimeA = new SimulationRuntime(createSimulation());
    const sessionA = createSession(runtimeA).session;

    const firstRun = execute(sessionA, "client");

    expect(runtimeA.simulation.status).toBe("completed");

    runtimeA.reset();

    expect(runtimeA.simulation.status).toBe("created");

    // Run 2 reuses the same runtime and session after the rewind.
    const replayedRun = execute(sessionA, "client");

    // Fresh runtime B with identical seed, config, and snapshot.
    const runtimeB = new SimulationRuntime(createSimulation());
    const freshRun = execute(createSession(runtimeB).session, "client");

    expect(replayedRun).toEqual(freshRun);
    expect(firstRun).toEqual(freshRun);
    expect(runtimeA.getMetrics()).toEqual(runtimeB.getMetrics());
    expect(requestOutcomes(runtimeA)).toEqual(requestOutcomes(runtimeB));
  });

  it("reset from mid-run restores the runtime for a full replay", () => {
    const runtimeA = new SimulationRuntime(createSimulation());
    const { engine, session } = createSession(runtimeA);

    session.prepare("client");
    engine.start();

    for (let i = 0; i < 50; i++) {
      engine.step();
    }

    expect(runtimeA.simulation.status).toBe("running");
    expect(runtimeA.eventQueue.size()).toBeGreaterThan(0);

    runtimeA.reset();

    expect(runtimeA.simulation.status).toBe("created");
    expect(runtimeA.eventQueue.isEmpty()).toBe(true);

    const replayedRun = execute(session, "client");

    const runtimeB = new SimulationRuntime(createSimulation());
    const freshRun = execute(createSession(runtimeB).session, "client");

    expect(replayedRun).toEqual(freshRun);
    expect(runtimeA.getMetrics()).toEqual(runtimeB.getMetrics());
    expect(requestOutcomes(runtimeA)).toEqual(requestOutcomes(runtimeB));
  });
});
