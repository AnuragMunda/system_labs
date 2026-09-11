/**
 * @file simulation.types.ts
 *
 * @description Domain types describing a simulation run: what architecture it
 * executes against, its lifecycle status, and the configuration that governs
 * how the load is generated.
 */

import { ArchitectureGraph } from "../architecture/architecture.types.js";

/** The lifecycle states a simulation can move through. */
export type SimulationStatus =
  "created" | "running" | "paused" | "completed" | "failed" | "cancelled";

/** Configuration controlling how a simulation generates and plays back load. */
export interface SimulationConfig {
  // Total simulation duration.
  durationMs: number;

  // Initial requests generated per second.
  requestsPerSecond: number;

  /**
   * Simulation playback speed.
   * 1 = real-time
   * 2 = 2x
   * 5 = 5x
   */
  simulationSpeed: number;

  // Random seed for deterministic simulations.
  // Same architecture + config + seed => same result.
  randomSeed?: number;

  // Maximum number of events processed in one simulation tick.
  // Prevents runaway simulations.
  maxEventsPerTick?: number;

  // Whether metrics should be collected.
  collectMetrics: boolean;

  // Emit simulation events for replay and visualization.
  emitEvents: boolean;
}

/**
 * A simulation runs a configured load pattern against an architecture and
 * tracks its lifecycle from scheduling through completion.
 */
export interface Simulation {
  id: string;
  architectureId: string;

  status: SimulationStatus;
  config: SimulationConfig;

  currentTimeMs: number;
  seed: number;

  architectureSnapshot: ArchitectureGraph;

  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}
