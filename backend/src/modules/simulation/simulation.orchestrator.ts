/**
 * @file simulation.orchestrator.ts
 *
 * @description The simulation orchestration service. It sits above the
 * framework-independent engine and owns the application-level concerns of
 * running a simulation: creating a run from a validated architecture snapshot
 * and configuration, wiring that run's isolated runtime state, coordinating
 * traffic generation with execution, and exposing lifecycle control and read
 * interfaces through plain DTOs.
 *
 * It deliberately contains no HTTP, persistence, queue, or authentication
 * concerns, and it does not re-implement engine behavior: lifecycle rules stay
 * in the engine's lifecycle matrix, and event semantics stay in the event
 * processor. Each run gets its own runtime, so simulations never share clock,
 * queue, random, or metrics state.
 */

import { randomUUID } from "node:crypto";

import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type {
  Simulation,
  SimulationConfig,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";
import type { SimulationMetrics } from "@/domain/simulation/metrics.types.js";

import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationSession } from "@/simulation-engine/core/simulation-session.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";

import type {
  CreateSimulationInput,
  SimulationReport,
  SimulationSnapshot,
  SimulationStepResult,
} from "./simulation.orchestrator.types.js";

/** The isolated engine stack backing one simulation run. */
interface SimulationRun {
  simulation: Simulation;
  runtime: SimulationRuntime;
  engine: SimulationEngine;
  session: SimulationSession;
  sourceNodeId: string;
}

/** A shallow copy of a config that never aliases mutable nested arrays. */
function cloneConfig(config: SimulationConfig): SimulationConfig {
  return {
    ...config,
    failures: config.failures?.map((failure) => ({ ...failure })),
    cacheKeys: config.cacheKeys ? [...config.cacheKeys] : undefined,
    databaseOperations: config.databaseOperations
      ? [...config.databaseOperations]
      : undefined,
  };
}

/**
 * Creates and manages simulation runs. Execution is synchronous and in-process:
 * the engine drives a virtual clock and never sleeps, so a full run is a
 * bounded loop. A background worker/queue can wrap this service later without
 * changing its contract.
 */
export class SimulationOrchestrator {
  private readonly runs = new Map<string, SimulationRun>();

  /**
   * Creates a simulation run in the `created` state with its own isolated
   * runtime. The run is not prepared or started until `start` or `run`.
   *
   * @throws If `id` is already registered or `sourceNodeId` is not present in
   *   the architecture snapshot.
   */
  create(input: CreateSimulationInput): SimulationSnapshot {
    const id = input.id ?? randomUUID();

    if (this.runs.has(id)) {
      throw new Error(`Simulation already exists: ${id}`);
    }

    this.assertSourceNode(input.architectureSnapshot, input.sourceNodeId);

    const simulation: Simulation = {
      id,
      architectureId: input.architectureId,
      status: "created",
      config: input.config,
      currentTimeMs: 0,
      seed: input.seed ?? input.config.randomSeed ?? 0,
      architectureSnapshot: input.architectureSnapshot,
      startedAt: new Date(),
      createdAt: new Date(),
    };

    this.runs.set(id, this.buildRun(simulation, input.sourceNodeId));

    return this.toSnapshot(simulation);
  }

  /**
   * Generates the run's load and transitions it into the `running` state,
   * without processing any events. Use `step` to advance it.
   */
  start(id: string): SimulationSnapshot {
    const run = this.getRun(id);

    run.session.prepare(run.sourceNodeId);
    run.engine.start();

    return this.toSnapshot(run.simulation);
  }

  /** Processes the next eligible event, returning whether one was processed. */
  step(id: string): SimulationStepResult {
    const run = this.getRun(id);
    const processed = run.engine.step();

    return { processed, simulation: this.toSnapshot(run.simulation) };
  }

  /** Prepares and executes the run to completion synchronously. */
  run(id: string): SimulationReport {
    const run = this.getRun(id);

    run.session.run(run.sourceNodeId);

    return this.getReport(id);
  }

  /** Pauses a running simulation. */
  pause(id: string): SimulationSnapshot {
    const run = this.getRun(id);
    run.engine.pause();

    return this.toSnapshot(run.simulation);
  }

  /** Resumes a paused simulation. */
  resume(id: string): SimulationSnapshot {
    const run = this.getRun(id);
    run.engine.resume();

    return this.toSnapshot(run.simulation);
  }

  /** Cancels a created, running, or paused simulation. */
  cancel(id: string): SimulationSnapshot {
    const run = this.getRun(id);
    run.engine.cancel();

    return this.toSnapshot(run.simulation);
  }

  /** Returns the current lifecycle status of a run. */
  getStatus(id: string): SimulationStatus {
    return this.getRun(id).simulation.status;
  }

  /** Returns a plain, copied view of a run's lifecycle state. */
  getSnapshot(id: string): SimulationSnapshot {
    return this.toSnapshot(this.getRun(id).simulation);
  }

  /** Returns the run's metrics snapshot at its current virtual time. */
  getMetrics(id: string): SimulationMetrics {
    return this.getRun(id).runtime.getMetrics();
  }

  /** Returns a run's lifecycle state together with its metrics. */
  getReport(id: string): SimulationReport {
    return { simulation: this.getSnapshot(id), metrics: this.getMetrics(id) };
  }

  /** Wires the isolated runtime stack for a single simulation. */
  private buildRun(
    simulation: Simulation,
    sourceNodeId: string,
  ): SimulationRun {
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

    return { simulation, runtime, engine, session, sourceNodeId };
  }

  /** Fails fast when the configured traffic source is not in the snapshot. */
  private assertSourceNode(
    snapshot: ArchitectureGraph,
    sourceNodeId: string,
  ): void {
    const exists = snapshot.nodes.some((node) => node.id === sourceNodeId);

    if (!exists) {
      throw new Error(
        `Traffic source node not found in architecture snapshot: ${sourceNodeId}`,
      );
    }
  }

  /** Resolves a registered run or throws when the id is unknown. */
  private getRun(id: string): SimulationRun {
    const run = this.runs.get(id);

    if (!run) {
      throw new Error(`Simulation not found: ${id}`);
    }

    return run;
  }

  /** Builds a copied DTO so callers never hold live runtime state. */
  private toSnapshot(simulation: Simulation): SimulationSnapshot {
    return {
      id: simulation.id,
      architectureId: simulation.architectureId,
      status: simulation.status,
      seed: simulation.seed,
      currentTimeMs: simulation.currentTimeMs,
      config: cloneConfig(simulation.config),
      startedAt: new Date(simulation.startedAt),
      completedAt: simulation.completedAt
        ? new Date(simulation.completedAt)
        : undefined,
      createdAt: new Date(simulation.createdAt),
    };
  }
}
