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
  durationMs: number;
  requestsPerSecond: number;
  simulationSpeed: number;
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

  createdAt: Date;
}
