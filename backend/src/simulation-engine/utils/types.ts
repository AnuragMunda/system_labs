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

import { LatencyHistogram } from "../metrics/latency-histogram.js";
import { SimulationRandom } from "../random/simulation-random.js";

/** The contract for turning a single simulation event into runtime transitions. */
export interface EventProcessor {
  process(event: SimulationEvent): void;
}

// ---------------------------------------------------------------------------
// ROUTING
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// COMPONENT RUNTIME
// ---------------------------------------------------------------------------

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

  circuit: ComponentCircuitBreakerState;

  /** Observability counters and samples for this component's metrics report. */
  metrics: ComponentRuntimeMetrics;
}

/**
 * Per-component observability state backing the metrics snapshot. Collects
 * counters and latency samples that are not otherwise captured by the runtime
 * state above; every field is formatted into the `SimulationMetrics` report by
 * the metrics snapshot builder. None of these fields affect simulation
 * behavior — they are pure observations.
 */
export interface ComponentRuntimeMetrics {
  /** Highest concurrent request count ever observed. */
  peakActiveRequests: number;

  /** Highest queue depth ever observed. */
  peakQueueDepth: number;
  /** Total requests admitted to the component's queue. */
  totalEnqueued: number;
  /** Total requests dequeued from the component's queue. */
  totalDequeued: number;
  /** Total requests discarded by `drop_oldest` overflow handling. */
  totalDropped: number;
  /** Total requests rejected because the queue was full or disabled. */
  totalRejected: number;
  /** Samples of how long requests waited in the component's queue. */
  queueWait: LatencyHistogram;

  /** Health state transitions observed for the component. */
  healthTransitions: number;
  /** Transitions into the `failed` state. */
  healthFailureCount: number;
  /** Transitions out of the `failed` state. */
  healthRecoveryCount: number;
  /** Simulated milliseconds spent in each health state (deltas only; the
   * open tail is credited at snapshot build). */
  timeInStateMs: Record<RuntimeComponentHealth, number>;
  /** Simulation time of the component's most recent health transition. */
  lastHealthTransitionAtMs: number;

  /** Replica count when the component was first initialized. */
  initialReplicas: number;
  /** Lowest replica count ever applied. */
  minimumReplicas: number;
  /** Highest replica count ever applied. */
  maximumReplicas: number;
  /** Times the component scaled up. */
  scaleUpCount: number;
  /** Times the component scaled down. */
  scaleDownCount: number;
  /** `autoscaling.evaluate` events processed for the component. */
  autoscalingEvaluationCount: number;

  /** Samples of processing latency for completed requests. */
  processingLatency: LatencyHistogram;
}

/** The run state of a component's circuit breaker. */
export type CircuitBreakerRunState = "closed" | "open" | "half-open";

/**
 * The mutable runtime state one component's circuit breaker maintains. Only
 * meaningful when `enabled` is true; a disabled breaker always stays closed.
 */
export interface ComponentCircuitBreakerState {
  enabled: boolean;
  failureThreshold: number;
  openDurationMs: number;

  state: CircuitBreakerRunState;

  /** Consecutive retryable failures feeding the trip decision. */
  consecutiveFailures: number;

  /** Simulation time the circuit was tripped open. */
  openedAtMs?: number;

  /** Identifies the current open/half-open cycle; invalidates stale timers. */
  generation: number;

  /** Whether a half-open probe request is currently in flight. */
  probeInFlight: boolean;

  /** The id of the request granted the half-open probe, when one is in flight. */
  probeRequestId?: string;
}

/** Result of asking the runtime whether a request may be admitted at a component. */
export type CircuitArrivalStatus = "open" | "probe-busy" | "admitted";

/** The outcome of recording a retryable failure against a circuit. */
export interface CircuitFailureRecord {
  opened: boolean;
  consecutiveFailures: number;
  failureThreshold: number;
  openedAtMs?: number;
  generation: number;
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

// ---------------------------------------------------------------------------
// QUEUE
// ---------------------------------------------------------------------------

/**
 * The result of a queue admission attempt (see
 * {@link SimulationRuntime.enqueueRequest}).
 */
export type QueueAdmissionResult =
  | {
      admitted: true;
      droppedRequestId?: string;
    }
  | {
      admitted: false;
      reason: "queue_full" | "queue_disabled";
    };

// ---------------------------------------------------------------------------
// CACHE
// ---------------------------------------------------------------------------

/** A single entry stored in a component's cache. */
export interface CacheEntry {
  /** The stable resource key the entry is stored under. */
  key: string;
  /** The cached "backend response". */
  value: unknown;
  /** Simulation time at which the entry was populated. */
  createdAtMs: number;
  /** Simulation time at which the entry expires; `Infinity` when it never
   * expires (`ttlMs === 0`). */
  expiresAtMs: number;
  /** Simulation time the entry was last read; drives LRU eviction. */
  lastAccessedAtMs: number;
}

/** The mutable runtime state one component's cache maintains. */
export interface CacheState {
  entries: Map<string, CacheEntry>;
  /** Total number of successful lookups (cache metrics, not processing metrics). */
  hits: number;
  /** Total number of lookup misses (cache metrics, not processing metrics). */
  misses: number;
  /** Total number of LRU evictions performed. */
  evictions: number;
  /** Highest number of entries the cache has ever held. */
  maxEntries: number;
}
