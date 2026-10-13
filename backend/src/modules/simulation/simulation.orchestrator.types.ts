/**
 * @file simulation.orchestrator.types.ts
 *
 * @description Application-level DTOs for the simulation orchestration service.
 * These describe what callers supply to start a run and the plain, serializable
 * views they read back. None of them reference the engine's live runtime state,
 * so callers cannot reach into (or mutate) a running simulation.
 */

import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type { SimulationMetrics } from "@/domain/simulation/metrics.types.js";
import type {
  SimulationConfig,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";

/**
 * The input required to create a simulation run.
 *
 * The architecture snapshot and configuration are expected to be validated at
 * the application boundary before reaching the orchestrator. The traffic source
 * is an orchestration concern: it is supplied here rather than being added to
 * {@link SimulationConfig}, which describes load shape, not topology.
 */
export interface CreateSimulationInput {
  /** The architecture this run was created from. */
  architectureId: string;

  /** The immutable architecture snapshot the run executes against. */
  architectureSnapshot: ArchitectureGraph;

  /** Load and runtime configuration for the run. */
  config: SimulationConfig;

  /** The component generated traffic originates from. */
  sourceNodeId: string;

  /**
   * Seed for deterministic execution. Falls back to `config.randomSeed`, then
   * to `0`, so the same snapshot, config, and seed always produce the same
   * result.
   */
  seed?: number;

  /** Optional explicit run id; generated when omitted. */
  id?: string;
}

/**
 * A plain, copied view of a simulation's lifecycle state. Returned by every
 * orchestrator read so the caller never receives the mutable state the runtime
 * continues to update.
 */
export interface SimulationSnapshot {
  id: string;
  architectureId: string;
  status: SimulationStatus;
  seed: number;
  currentTimeMs: number;
  config: SimulationConfig;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

/** The outcome of advancing a simulation by a single event. */
export interface SimulationStepResult {
  /** Whether an event was processed; `false` when nothing eligible remained. */
  processed: boolean;
  simulation: SimulationSnapshot;
}

/** A simulation's final (or current) state together with its metrics. */
export interface SimulationReport {
  simulation: SimulationSnapshot;
  metrics: SimulationMetrics;
}
