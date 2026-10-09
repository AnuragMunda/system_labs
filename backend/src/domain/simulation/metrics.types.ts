/**
 * @file metrics.types.ts
 *
 * @description Domain types describing the aggregated metrics of a simulation
 * run: a hierarchical, immutable summary of how the simulated system behaved.
 * The runtime exposes a snapshot of these (`getMetrics()`); they are intended
 * to be serializable by a future API for reporting.
 *
 * All numeric summaries are zero-safe: empty inputs produce `0` (never `NaN`
 * or `Infinity`). Rates are derived, not recorded, so they stay consistent
 * with their count primitives.
 */

/** A mean-plus-percentile summary of a set of latency samples. */
export interface LatencySummary {
  /** Number of samples summarized. */
  count: number;
  /** Arithmetic mean latency, in milliseconds. */
  avgMs: number;
  /** Estimated 50th percentile latency, in milliseconds. */
  p50Ms: number;
  /** Estimated 95th percentile latency, in milliseconds. */
  p95Ms: number;
  /** Estimated 99th percentile latency, in milliseconds. */
  p99Ms: number;
  /** Minimum observed latency, in milliseconds. */
  minMs: number;
  /** Maximum observed latency, in milliseconds. */
  maxMs: number;
}

/** Aggregate traffic observed across the whole simulation. */
export interface SimulationRequestMetrics {
  /** Total requests generated (created) during the simulation. */
  generated: number;
  /** Requests that completed successfully. */
  completed: number;
  /** Requests that failed permanently. */
  failed: number;
  /** Total retry attempts performed (request.retry events). */
  retries: number;
  /** Requests not in a terminal state at snapshot time: pending, queued, or
   * being processed. Derived, so `generated = completed + failed + inFlight`. */
  inFlight: number;
  /** Requests currently waiting in queues at snapshot time. */
  queued: number;
  /** Completed / (completed + failed); `0` when no requests terminated. */
  successRate: number;
  /** Failed / (completed + failed); `0` when no requests terminated. */
  errorRate: number;
  /** Terminal failures grouped by reason string. */
  failedByReason: Record<string, number>;
}

/** Aggregate failure tallies. */
export interface SimulationFailureMetrics {
  /** Total permanent request failures. */
  total: number;
  /** Failures grouped by reason string. */
  byReason: Record<string, number>;
  /** Failures grouped by the node where they were observed. */
  byNode: Record<string, number>;
}

/** Aggregate transmission tallies across every connection. */
export interface SimulationNetworkMetrics {
  /** Total transmission attempts (delivered and lost). */
  transmissions: number;
  /** Transmissions lost to packet loss. */
  packetLosses: number;
  /** Lost / transmissions; `0` when no transmissions occurred. */
  packetLossRate: number;
  /** Cumulative delivery delay of delivered transmissions, in ms. */
  totalLatencyMs: number;
  /** Distribution of delivery delays of delivered transmissions. */
  summary: LatencySummary;
}

/** Per-request work accounting for one component. */
export interface ComponentTrafficMetrics {
  /** Requests currently being processed at snapshot time. */
  active: number;
  /** Peak concurrent requests ever observed. */
  peakActive: number;
  /** Requests successfully processed by the component. */
  processed: number;
  /** Processing attempts (successes and failures). */
  attempts: number;
  /** Processing attempts that failed (errorRate-driven). */
  failedAttempts: number;
  /** Retries initiated at this component. */
  retries: number;
}

/** Latency summary for a component's processing path. */
export interface ComponentLatencyMetrics {
  /** Cumulative processing latency of completed requests, in ms. */
  totalMs: number;
  /** Mean processing latency, in ms. */
  avgMs: number;
  /** Latency of the most recently completed request, in ms. */
  lastMs: number;
  /** Minimum observed processing latency, in ms. */
  minMs: number;
  /** Maximum observed processing latency, in ms. */
  maxMs: number;
  /** Estimated 50th percentile processing latency, in ms. */
  p50Ms: number;
  /** Estimated 95th percentile processing latency, in ms. */
  p95Ms: number;
  /** Estimated 99th percentile processing latency, in ms. */
  p99Ms: number;
}

/** Queue observability for one component. */
export interface ComponentQueueMetrics {
  /** Requests waiting in the queue at snapshot time. */
  currentDepth: number;
  /** Peak queue depth ever observed. */
  peakDepth: number;
  /** Total requests admitted to the queue. */
  totalEnqueued: number;
  /** Total requests pulled from the queue for processing. */
  totalDequeued: number;
  /** Total requests discarded by `drop_oldest` overflow handling. */
  totalDropped: number;
  /** Total requests rejected because the queue was full/disabled. */
  totalRejected: number;
  /** Time requests spent waiting in the queue. */
  wait: LatencySummary;
}

/** Autoscaling observability for one component. */
export interface ComponentAutoscalingMetrics {
  /** Whether autoscaling was configured for the component. */
  enabled: boolean;
  /** Replica count at the start of the simulation. */
  initialReplicas: number;
  /** Replica count at snapshot time. */
  currentReplicas: number;
  /** Lowest replica count ever applied. */
  minReplicas: number;
  /** Highest replica count ever applied. */
  maxReplicas: number;
  /** Times the component scaled up. */
  scaleUps: number;
  /** Times the component scaled down. */
  scaleDowns: number;
  /** `autoscaling.evaluate` events processed for the component. */
  evaluations: number;
}

/** Health observability for one component. */
export interface ComponentHealthMetrics {
  /** Current health state at snapshot time. */
  state: "healthy" | "degraded" | "critical" | "failed";
  /** Number of health state transitions observed. */
  transitions: number;
  /** Transitions into the `failed` state. */
  failures: number;
  /** Transitions out of the `failed` state. */
  recoveries: number;
  /** Simulated time spent in each health state, in ms. */
  timeInStateMs: Record<string, number>;
}

/** Per-component metrics summary. */
export interface ComponentMetrics {
  nodeId: string;
  type: string;
  traffic: ComponentTrafficMetrics;
  latency: ComponentLatencyMetrics;
  queue: ComponentQueueMetrics;
  autoscaling: ComponentAutoscalingMetrics;
  health: ComponentHealthMetrics;
}

/** Cache observability for one cache node. */
export interface CacheNodeMetrics {
  /** Total lookup attempts (hits + misses). */
  requests: number;
  hits: number;
  misses: number;
  evictions: number;
  currentEntries: number;
  maxEntries: number;
  /** Hits / (hits + misses); `0` when no lookups occurred. */
  hitRatio: number;
}

/** Aggregated cache observability. */
export interface SimulationCacheMetrics {
  totals: CacheNodeMetrics;
  byNode: Record<string, CacheNodeMetrics>;
}

/** Database observability for one database node. */
export interface DatabaseNodeMetrics {
  nodeId: string;
  /** Database operations that arrived at the node. */
  requests: number;
  /** Read operations. */
  reads: number;
  /** Write operations. */
  writes: number;
  /** Processing attempts that failed at the node. */
  failedAttempts: number;
  /** Cumulative processing latency of completed operations, in ms. */
  totalLatencyMs: number;
  /** Mean processing latency, in ms. */
  avgLatencyMs: number;
}

/** Aggregated database observability. */
export interface SimulationDatabaseMetrics {
  totals: DatabaseNodeMetrics;
  byNode: Record<string, DatabaseNodeMetrics>;
}

/** Queue admission tallies across the whole simulation. */
export interface QueueTotalsMetrics {
  enqueued: number;
  dequeued: number;
  dropped: number;
  rejected: number;
}

/** Queue observability across the whole simulation. */
export interface SimulationQueueMetrics {
  totals: QueueTotalsMetrics;
  byNode: Record<string, ComponentQueueMetrics>;
}

/** Aggregated autoscaling observability. */
export interface SimulationAutoscalingMetrics {
  byNode: Record<string, ComponentAutoscalingMetrics>;
}

/** Aggregated health observability. */
export interface SimulationHealthMetrics {
  byNode: Record<string, ComponentHealthMetrics>;
}

/** Latency considerations across the whole simulation. */
export interface SimulationLatencyMetrics {
  /** End-to-end latency of requests that completed successfully. */
  endToEnd: LatencySummary;
  /** End-to-end latency of requests that failed permanently. */
  failed: LatencySummary;
  /** Delivery delay of network transmissions. */
  network: LatencySummary;
  /** Processing latency per component. */
  processing: {
    totals: LatencySummary;
    byNode: Record<string, LatencySummary>;
  };
  /** Time requests spent waiting in queues, per component. */
  queue: {
    byNode: Record<string, LatencySummary>;
  };
}

/**
 * The immutable metrics snapshot of a simulation at a point in time.
 *
 * `getMetrics()` is deterministic for a given architecture, config, and seed:
 * every counter and derived summary is a function of the simulation's virtual
 * clock and runtime state, never the wall clock.
 */
export interface SimulationMetrics {
  simulationId: string;
  /** Configured simulation duration, in ms. */
  durationMs: number;
  /** Simulation time that was actually processed at snapshot time, in ms. */
  processedDurationMs: number;
  /** Timestamp (virtual clock) at which the snapshot was taken, in ms. */
  recordedAtMs: number;
  /** Whether metrics recording was enabled for the simulation. */
  collectMetrics: boolean;

  requests: SimulationRequestMetrics;
  failures: SimulationFailureMetrics;
  network: SimulationNetworkMetrics;
  latency: SimulationLatencyMetrics;
  components: Record<string, ComponentMetrics>;
  cache: SimulationCacheMetrics;
  database: SimulationDatabaseMetrics;
  queues: SimulationQueueMetrics;
  autoscaling: SimulationAutoscalingMetrics;
  health: SimulationHealthMetrics;
}
