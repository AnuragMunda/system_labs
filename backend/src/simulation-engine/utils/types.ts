/**
 * @file types.ts
 *
 * @description Shared type contracts for the simulation engine: the event
 * processor interface, the routing strategy/context contracts, and the runtime
 * component state shapes. Domain-level types live under `src/domain`.
 */

import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import { RuntimeComponentHealth } from "@/domain/architecture/component.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRandom } from "../random/simulation-random.js";

/** The contract for turning a single simulation event into runtime transitions. */
export interface EventProcessor {
  process(event: SimulationEvent): void;
}

/**
 * The contract for choosing which of a node's outgoing edges a request should
 * travel across next. Implementations may hold per-source-node state (for
 * example round-robin counters) and must select deterministically.
 */
export interface RoutingStrategy {
  selectEdge(
    edges: ArchitectureEdge[],
    context: RoutingContext,
  ): ArchitectureEdge;
}

/** Inputs available to a routing strategy when it decides which outgoing edge to use. */
export interface RoutingContext {
  /** The node whose outgoing edges are being evaluated. */
  sourceNodeId: string;
  /** The id of the request being routed. */
  requestId: string;
  /** Returns the current number of in-flight requests for a target node. */
  getActiveRequestCount: (nodeId: string) => number;
  /** The simulation's deterministic PRNG instance. */
  random: SimulationRandom;
}

/** The mutable runtime state the engine maintains for one component. */
export interface ComponentRuntimeState {
  nodeId: string;
  health: RuntimeComponentHealth;

  replicas: number;
  effectiveConcurrency: number; // Max requests processable concurrently (replicas * concurrency).

  activeRequests: number; // Number of requests currently being processed.
  processedRequests: number; // Total number of requests successfully processed.

  totalProcessingAttempts: number; // Total processing attempts (successes and failures).
  failedProcessingAttempts: number; // Processing attempts that failed (errorRate-driven).

  totalProcessingLatencyMs: number; // Cumulative processing latency for completed requests.
  lastProcessingLatencyMs?: number; // Latency of the most recently completed request.

  recoveryGeneration: number; // Identifies the current failure/recovery cycle.
}

/** The observables a component's health is derived from. */
export interface ComponentHealthMetrics {
  /** Fraction of effective concurrency currently in use (0-1). */
  utilization: number;
  /** Proportion of processing attempts that failed (0-1). */
  errorRate: number;
  /** Average processing latency in milliseconds. */
  averageLatencyMs: number;
}

/** The health transition produced when evaluating a component's health. */
export interface ComponentHealthStateChange {
  previousHealth: RuntimeComponentHealth;
  health: RuntimeComponentHealth;
}
