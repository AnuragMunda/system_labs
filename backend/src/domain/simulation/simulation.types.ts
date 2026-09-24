/**
 * @file simulation.types.ts
 *
 * @description Domain types describing a simulation run: what architecture it
 * executes against, its lifecycle status, and the configuration that governs
 * how the load is generated.
 */

import { ArchitectureGraph } from "../architecture/architecture.types.js";
import { DatabaseOperation } from "./request.types.js";

/** The lifecycle states a simulation can move through. */
export type SimulationStatus =
  "created" | "running" | "paused" | "completed" | "failed" | "cancelled";

/**
 * A scheduled component outage: the node fails at `failedAtMs`.
 *
 * Automatic recovery is not scheduled from the failure configuration; it is
 * driven by the failed component's `recoveryDelayMs` node config.
 */
export interface FailureSchedule {
  nodeId: string;
  failedAtMs: number;
}

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

  /**
   * Stable resource keys requests cycle through deterministically when a
   * simulation includes a cache component (e.g. `["GET:/users/123",
   * "GET:/products/42"]`). Keys are assigned round-robin by arrival slot, so
   * multiple requests share a key and the cache can produce real hits.
   *
   * When omitted, requests receive a unique synthetic key
   * (`GET:/resource/${sequence}`), which never produces a hit.
   */
  cacheKeys?: string[];

  /**
   * Database operations requests cycle through deterministically when a
   * simulation includes a database component (e.g. `["read", "write"]`).
   * Operations are assigned round-robin by arrival slot, so the database
   * observes a stable mix of reads and writes.
   *
   * When omitted, requests default to a `"read"` operation.
   */
  databaseOperations?: DatabaseOperation[];

  // Scheduled component failures and recoveries applied during the run.
  failures?: FailureSchedule[];
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
