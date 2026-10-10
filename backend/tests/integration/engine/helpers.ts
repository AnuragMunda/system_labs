/**
 * @file helpers.ts
 *
 * @description Shared harness for the engine integration scenarios. It wires
 * the real production objects together exactly as a worker process would —
 * `SimulationRuntime` + `DefaultEventProcessor` + `SimulationEngine` +
 * `SimulationSession` — and provides deterministic graph/config builders plus
 * an ordered event trace. These tests do not touch the database.
 */

import { vi } from "vitest";

import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationSession } from "@/simulation-engine/core/simulation-session.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";

import type { Simulation } from "@/domain/simulation/simulation.types.js";
import type {
  SimulationEvent,
  SimulationEventType,
} from "@/domain/simulation/event.types.js";
import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type { ArchitectureNode } from "@/domain/architecture/component.types.js";

/** Builds an architecture node with a zeroed position. */
export function node(
  id: string,
  type: ArchitectureNode["type"],
  config: ArchitectureNode["config"] = {},
): ArchitectureNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

/** Builds a directed connection identified by its endpoints. */
export function edge(
  source: string,
  target: string,
  config: NonNullable<ArchitectureGraph["edges"]>[number]["config"] = {},
): NonNullable<ArchitectureGraph["edges"]>[number] {
  return { id: `${source}-${target}`, source, target, config };
}

/** The subset of simulation config the scenarios vary. */
export interface SimulationOverrides {
  durationMs?: number;
  requestsPerSecond?: number;
  seed?: number;
  collectMetrics?: boolean;
  cacheKeys?: string[];
  databaseOperations?: ("read" | "write")[];
  failures?: { nodeId: string; failedAtMs: number }[];
}

/** Builds a created simulation for the given graph with sensible defaults. */
export function createSimulation(
  graph: ArchitectureGraph,
  overrides: SimulationOverrides = {},
): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: overrides.durationMs ?? 1000,
      requestsPerSecond: overrides.requestsPerSecond ?? 10,
      simulationSpeed: 1,
      collectMetrics: overrides.collectMetrics ?? true,
      emitEvents: true,
      cacheKeys: overrides.cacheKeys,
      databaseOperations: overrides.databaseOperations,
      failures: overrides.failures,
    },
    currentTimeMs: 0,
    seed: overrides.seed ?? 42,
    architectureSnapshot: graph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

/** The fully wired engine stack for one simulation. */
export interface Harness {
  simulation: Simulation;
  runtime: SimulationRuntime;
  processor: DefaultEventProcessor;
  engine: SimulationEngine;
  session: SimulationSession;
}

/** Composes the real runtime, processor, engine, and session. */
export function createHarness(
  graph: ArchitectureGraph,
  overrides: SimulationOverrides = {},
): Harness {
  const simulation = createSimulation(graph, overrides);
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

  return { simulation, runtime, processor, engine, session };
}

/** The externally observable ordering of a run, independent of event ids. */
export interface EventSignature {
  type: SimulationEventType;
  timestampMs: number;
  requestId: string | undefined;
  reason: string | undefined;
}

/**
 * Runs the session to completion while recording every processed event, in
 * processing order. Processing is wrapped on the prototype so nested/dynamic
 * events are captured too.
 */
export function runWithTrace(
  session: SimulationSession,
  entryNodeId: string,
): EventSignature[] {
  const processed: EventSignature[] = [];
  const original = DefaultEventProcessor.prototype.process;

  const spy = vi
    .spyOn(DefaultEventProcessor.prototype, "process")
    .mockImplementation(function (event: SimulationEvent) {
      processed.push({
        type: event.type,
        timestampMs: event.timestampMs,
        requestId: event.payload?.requestId as string | undefined,
        reason: event.payload?.reason as string | undefined,
      });
      original.call(this, event);
    });

  try {
    session.run(entryNodeId);
  } finally {
    spy.mockRestore();
  }

  return processed;
}

/** Terminal request outcomes keyed by request id (`status:attempts`). */
export function requestOutcomes(
  runtime: SimulationRuntime,
): Record<string, string> {
  return Object.fromEntries(
    runtime
      .getAllRequests()
      .map((request) => [request.id, `${request.status}:${request.attempts}`]),
  );
}

/** Counts events of a given type in a trace. */
export function countEvents(
  trace: EventSignature[],
  type: SimulationEventType,
): number {
  return trace.filter((event) => event.type === type).length;
}

/** Returns the trace indices of the given event type, in order. */
export function indicesOf(
  trace: EventSignature[],
  type: SimulationEventType,
): number[] {
  const indices: number[] = [];

  trace.forEach((event, index) => {
    if (event.type === type) indices.push(index);
  });

  return indices;
}
