/**
 * @file metrics-snapshot.ts
 *
 * @description Builds an immutable, deterministic `SimulationMetrics` snapshot
 * from the simulation runtime's state at a point in time.
 *
 * The builder is a pure function over a plain {@link MetricsSnapshotSource}
 * description of the runtime; it never mutates runtime state. Request-level
 * counts and end-to-end latencies are derived from the request map, component
 * health/processing/queue observations come from each component's metrics
 * state, and everything that has no single owner (network, retries, database
 * operations, failures) comes from the runtime-level metrics store.
 *
 * The resulting snapshot is deeply frozen so callers cannot mutate the report
 * after it is produced, and identical runtime state always produces identical
 * JSON output (the simulation is deterministic).
 */

import {
  CacheNodeMetrics,
  ComponentAutoscalingMetrics,
  ComponentHealthMetrics,
  ComponentLatencyMetrics,
  ComponentMetrics,
  ComponentQueueMetrics,
  ComponentTrafficMetrics,
  DatabaseNodeMetrics,
  LatencySummary,
  QueueTotalsMetrics,
  SimulationCacheMetrics,
  SimulationMetrics,
} from "@/domain/simulation/metrics.types.js";
import { SimulationRequest } from "@/domain/simulation/request.types.js";
import {
  ComponentRuntimeMetrics,
  ComponentRuntimeState,
} from "../utils/types.js";
import { LatencyHistogram } from "./latency-histogram.js";

/** A node-count snapshot for the cache section of the metrics report. */
export interface CacheNodeSnapshot {
  nodeId: string;
  hits: number;
  misses: number;
  evictions: number;
  currentEntries: number;
  maxEntries: number;
}

/**
 * A read-only description of the runtime used to build the metrics snapshot.
 * The simulation runtime assembles this snapshot of its state; the builder
 * never touches the runtime itself.
 */
export interface MetricsSnapshotSource {
  collectMetrics: boolean;
  simulationId: string;
  durationMs: number;
  processedDurationMs: number;

  /** Every request in the simulation, in insertion order. */
  requests: SimulationRequest[];

  /** Live per-component runtime state. */
  components: ComponentRuntimeState[];

  /** Maps a node id to its architecture type. */
  nodeTypes: ReadonlyMap<string, string>;

  /** Whether autoscaling is configured for each component. */
  autoscalingEnabled: ReadonlyMap<string, boolean>;

  /** Current queue depth per component. */
  queueDepths: ReadonlyMap<string, number>;

  /** Cache usage per cache node. */
  cacheNodes: CacheNodeSnapshot[];

  /** Runtime-level database operation counts per database node. */
  dbOperations: Readonly<Record<string, { read: number; write: number }>>;

  failureByReason: Readonly<Record<string, number>>;
  failureByNode: Readonly<Record<string, number>>;
  retriesByNode: Readonly<Record<string, number>>;
  totalRetries: number;
  transmissions: number;
  packetLosses: number;
  networkSummary: LatencySummary;
}

function zeroLatencySummary(): LatencySummary {
  return {
    count: 0,
    avgMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    minMs: 0,
    maxMs: 0,
  };
}

function roundLatency(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;

  for (const nested of Object.values(value as object)) {
    deepFreeze(nested);
  }

  return Object.freeze(value);
}

/** Counts requests by terminal status (all others are in-flight). */
function countByStatus(requests: SimulationRequest[]): {
  completed: number;
  failed: number;
  inFlight: number;
} {
  let completed = 0;
  let failed = 0;

  for (const request of requests) {
    if (request.status === "completed") completed++;
    else if (request.status === "failed") failed++;
  }

  return { completed, failed, inFlight: requests.length - completed - failed };
}

/**
 * Builds the metrics snapshot for the given runtime state. When metrics
 * collection is disabled the report is a requirement-shaped, all-zero
 * snapshot: the runtime performs no recording, so nothing meaningful can be
 * reported.
 */
export function buildSimulationMetrics(
  source: MetricsSnapshotSource,
): SimulationMetrics {
  return deepFreeze(
    source.collectMetrics ? buildEnabled(source) : buildDisabled(source),
  );
}

function buildDisabled(source: MetricsSnapshotSource): SimulationMetrics {
  const emptySummary = zeroLatencySummary();

  return {
    simulationId: source.simulationId,
    durationMs: source.durationMs,
    processedDurationMs: source.processedDurationMs,
    recordedAtMs: source.processedDurationMs,
    collectMetrics: false,

    requests: {
      generated: 0,
      completed: 0,
      failed: 0,
      retries: 0,
      successRate: 0,
      errorRate: 0,
      inFlight: 0,
      queued: 0,
      failedByReason: {},
    },

    failures: {
      total: 0,
      byReason: {},
      byNode: {},
    },

    network: {
      transmissions: 0,
      packetLosses: 0,
      packetLossRate: 0,
      totalLatencyMs: 0,
      summary: emptySummary,
    },

    latency: {
      endToEnd: emptySummary,
      failed: emptySummary,
      network: emptySummary,
      processing: {
        totals: emptySummary,
        byNode: {},
      },
      queue: {
        byNode: {},
      },
    },

    components: {},
    cache: {
      totals: {
        requests: 0,
        hits: 0,
        misses: 0,
        evictions: 0,
        currentEntries: 0,
        maxEntries: 0,
        hitRatio: 0,
      },
      byNode: {},
    },
    database: {
      totals: buildDatabaseNodeMetrics("", 0, 0, 0, 0, 0, 0),
      byNode: {},
    },
    queues: {
      totals: { enqueued: 0, dequeued: 0, dropped: 0, rejected: 0 },
      byNode: {},
    },
    autoscaling: {
      byNode: {},
    },
    health: {
      byNode: {},
    },
  };
}

function buildEnabled(source: MetricsSnapshotSource): SimulationMetrics {
  const totals = countByStatus(source.requests);
  const target = totals.completed + totals.failed;

  const components: Record<string, ComponentMetrics> = {};
  const processingByNode: Record<string, LatencySummary> = {};
  const queueWaitByNode: Record<string, LatencySummary> = {};
  const autoscalingByNode: Record<string, ComponentAutoscalingMetrics> = {};
  const healthByNode: Record<string, ComponentHealthMetrics> = {};
  const queueByNode: Record<string, ComponentQueueMetrics> = {};

  const mergedProcessing = new LatencyHistogram();
  const endToEnd = new LatencyHistogram();
  const failedLatency = new LatencyHistogram();

  for (const component of source.components) {
    const nodeType = source.nodeTypes.get(component.nodeId) ?? "service";
    const observability = component.metrics;

    const processingSummary = observability.processingLatency.summary();
    const queueWaitSummary = observability.queueWait.summary();

    mergedProcessing.merge(observability.processingLatency.clone());

    const timeInStateMs = { ...observability.timeInStateMs };
    timeInStateMs[component.health] +=
      source.processedDurationMs - observability.lastHealthTransitionAtMs;

    components[component.nodeId] = buildComponentMetrics(
      component,
      nodeType,
      processingSummary,
      queueWaitSummary,
      source.queueDepths.get(component.nodeId) ?? 0,
      source.retriesByNode[component.nodeId] ?? 0,
      source.autoscalingEnabled.get(component.nodeId) ?? false,
      timeInStateMs,
    );

    if (processingSummary.count > 0) {
      processingByNode[component.nodeId] = processingSummary;
    }

    if (queueWaitSummary.count > 0) {
      queueWaitByNode[component.nodeId] = queueWaitSummary;
    }

    if (
      hasQueueActivity(component, source.queueDepths.get(component.nodeId) ?? 0)
    ) {
      queueByNode[component.nodeId] = buildComponentQueueMetrics(
        observability,
        queueWaitSummary,
        source.queueDepths.get(component.nodeId) ?? 0,
      );
    }

    autoscalingByNode[component.nodeId] = {
      enabled: source.autoscalingEnabled.get(component.nodeId) ?? false,
      initialReplicas: observability.initialReplicas,
      currentReplicas: component.replicas,
      minReplicas: observability.minimumReplicas,
      maxReplicas: observability.maximumReplicas,
      scaleUps: observability.scaleUpCount,
      scaleDowns: observability.scaleDownCount,
      evaluations: observability.autoscalingEvaluationCount,
    };

    healthByNode[component.nodeId] = {
      state: component.health,
      transitions: observability.healthTransitions,
      failures: observability.healthFailureCount,
      recoveries: observability.healthRecoveryCount,
      timeInStateMs,
    };
  }

  for (const request of source.requests) {
    if (request.status === "completed") {
      endToEnd.record(request.completedAtMs! - request.createdAtMs);
    } else if (request.status === "failed") {
      failedLatency.record(request.failedAtMs! - request.createdAtMs);
    }
  }

  const networkTotalLatencyMs = roundLatency(
    source.networkSummary.avgMs * source.networkSummary.count,
  );

  return {
    simulationId: source.simulationId,
    durationMs: source.durationMs,
    processedDurationMs: source.processedDurationMs,
    recordedAtMs: source.processedDurationMs,
    collectMetrics: true,

    requests: {
      generated: source.requests.length,
      completed: totals.completed,
      failed: totals.failed,
      retries: source.totalRetries,
      successRate: ratio(totals.completed, target),
      errorRate: ratio(totals.failed, target),
      inFlight: totals.inFlight,
      queued: source.requests.reduce(
        (count, request) =>
          request.queuedAtMs !== undefined ? count + 1 : count,
        0,
      ),
      failedByReason: source.failureByReason,
    },

    failures: {
      total: totals.failed,
      byReason: source.failureByReason,
      byNode: source.failureByNode,
    },

    network: {
      transmissions: source.transmissions,
      packetLosses: source.packetLosses,
      packetLossRate: ratio(source.packetLosses, source.transmissions),
      totalLatencyMs: networkTotalLatencyMs,
      summary: source.networkSummary,
    },

    latency: {
      endToEnd: endToEnd.summary(),
      failed: failedLatency.summary(),
      network: source.networkSummary,
      processing: {
        totals: mergedProcessing.summary(),
        byNode: processingByNode,
      },
      queue: {
        byNode: queueWaitByNode,
      },
    },

    components,
    cache: buildCacheMetrics(source.cacheNodes),
    database: buildDatabaseMetrics(source),
    queues: {
      totals: buildQueueTotals(source.components),
      byNode: queueByNode,
    },
    autoscaling: {
      byNode: autoscalingByNode,
    },
    health: {
      byNode: healthByNode,
    },
  };
}

function buildComponentMetrics(
  component: ComponentRuntimeState,
  type: string,
  processing: LatencySummary,
  queueWait: LatencySummary,
  currentQueueDepth: number,
  retries: number,
  autoscalingEnabled: boolean,
  timeInStateMs: ComponentRuntimeMetrics["timeInStateMs"],
): ComponentMetrics {
  const latency: ComponentLatencyMetrics = {
    totalMs: component.totalProcessingLatencyMs,
    avgMs: roundLatency(
      ratio(component.totalProcessingLatencyMs, component.processedRequests),
    ),
    lastMs: component.lastProcessingLatencyMs ?? 0,
    minMs: processing.minMs,
    maxMs: processing.maxMs,
    p50Ms: processing.p50Ms,
    p95Ms: processing.p95Ms,
    p99Ms: processing.p99Ms,
  };

  const traffic: ComponentTrafficMetrics = {
    active: component.activeRequests,
    peakActive: component.metrics.peakActiveRequests,
    processed: component.processedRequests,
    attempts: component.totalProcessingAttempts,
    failedAttempts: component.failedProcessingAttempts,
    retries,
  };

  const autoscaling: ComponentAutoscalingMetrics = {
    enabled: autoscalingEnabled,
    initialReplicas: component.metrics.initialReplicas,
    currentReplicas: component.replicas,
    minReplicas: component.metrics.minimumReplicas,
    maxReplicas: component.metrics.maximumReplicas,
    scaleUps: component.metrics.scaleUpCount,
    scaleDowns: component.metrics.scaleDownCount,
    evaluations: component.metrics.autoscalingEvaluationCount,
  };

  return {
    nodeId: component.nodeId,
    type,
    traffic,
    latency,
    queue: buildComponentQueueMetrics(
      component.metrics,
      queueWait,
      currentQueueDepth,
    ),
    autoscaling,
    health: buildComponentHealthMetrics(component, timeInStateMs),
  };
}

function hasQueueActivity(
  component: ComponentRuntimeState,
  currentDepth: number,
): boolean {
  const metrics = component.metrics;

  return (
    currentDepth > 0 ||
    metrics.peakQueueDepth > 0 ||
    metrics.totalEnqueued > 0 ||
    metrics.totalRejected > 0 ||
    metrics.totalDropped > 0
  );
}

function buildComponentQueueMetrics(
  metrics: ComponentRuntimeMetrics,
  wait: LatencySummary,
  currentDepth: number,
): ComponentQueueMetrics {
  return {
    currentDepth,
    peakDepth: metrics.peakQueueDepth,
    totalEnqueued: metrics.totalEnqueued,
    totalDequeued: metrics.totalDequeued,
    totalDropped: metrics.totalDropped,
    totalRejected: metrics.totalRejected,
    wait,
  };
}

function buildComponentHealthMetrics(
  component: ComponentRuntimeState,
  timeInStateMs: ComponentRuntimeMetrics["timeInStateMs"],
): ComponentHealthMetrics {
  return {
    state: component.health,
    transitions: component.metrics.healthTransitions,
    failures: component.metrics.healthFailureCount,
    recoveries: component.metrics.healthRecoveryCount,
    timeInStateMs: { ...timeInStateMs },
  };
}

function buildCacheMetrics(
  cacheNodes: CacheNodeSnapshot[],
): SimulationCacheMetrics {
  const totals: CacheNodeMetrics = {
    requests: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    currentEntries: 0,
    maxEntries: 0,
    hitRatio: 0,
  };

  const byNode: Record<string, CacheNodeMetrics> = {};

  for (const cache of cacheNodes) {
    const node: CacheNodeMetrics = {
      requests: cache.hits + cache.misses,
      hits: cache.hits,
      misses: cache.misses,
      evictions: cache.evictions,
      currentEntries: cache.currentEntries,
      maxEntries: cache.maxEntries,
      hitRatio: ratio(cache.hits, cache.hits + cache.misses),
    };

    byNode[cache.nodeId] = node;

    totals.requests += node.requests;
    totals.hits += node.hits;
    totals.misses += node.misses;
    totals.evictions += node.evictions;
    totals.currentEntries += node.currentEntries;
    totals.maxEntries = Math.max(totals.maxEntries, node.maxEntries);
  }

  totals.hitRatio = ratio(totals.hits, totals.requests);

  return { totals, byNode };
}

function buildDatabaseMetrics(
  source: MetricsSnapshotSource,
): SimulationMetrics["database"] {
  const totals: DatabaseNodeMetrics = buildDatabaseNodeMetrics(
    "",
    0,
    0,
    0,
    0,
    0,
    0,
  );
  const byNode: Record<string, DatabaseNodeMetrics> = {};

  for (const component of source.components) {
    if (source.nodeTypes.get(component.nodeId) !== "database") continue;

    const operations = source.dbOperations[component.nodeId];
    const node: DatabaseNodeMetrics = {
      nodeId: component.nodeId,
      requests: component.processedRequests,
      reads: operations?.read ?? 0,
      writes: operations?.write ?? 0,
      failedAttempts: component.failedProcessingAttempts,
      totalLatencyMs: component.totalProcessingLatencyMs,
      avgLatencyMs: ratio(
        component.totalProcessingLatencyMs,
        component.processedRequests,
      ),
    };

    byNode[component.nodeId] = node;

    totals.requests += node.requests;
    totals.reads += node.reads;
    totals.writes += node.writes;
    totals.failedAttempts += node.failedAttempts;
    totals.totalLatencyMs += node.totalLatencyMs;
  }

  totals.avgLatencyMs = ratio(totals.totalLatencyMs, totals.requests);

  return { totals, byNode };
}

function buildDatabaseNodeMetrics(
  nodeId: string,
  requests: number,
  reads: number,
  writes: number,
  failedAttempts: number,
  totalLatencyMs: number,
  avgLatencyMs: number,
): DatabaseNodeMetrics {
  return {
    nodeId,
    requests,
    reads,
    writes,
    failedAttempts,
    totalLatencyMs,
    avgLatencyMs,
  };
}

function buildQueueTotals(
  components: ComponentRuntimeState[],
): QueueTotalsMetrics {
  return {
    enqueued: sumComponents(components, (m) => m.totalEnqueued),
    dequeued: sumComponents(components, (m) => m.totalDequeued),
    dropped: sumComponents(components, (m) => m.totalDropped),
    rejected: sumComponents(components, (m) => m.totalRejected),
  };
}

function sumComponents(
  components: ComponentRuntimeState[],
  pick: (metrics: ComponentRuntimeMetrics) => number,
): number {
  return components.reduce(
    (total, component) => total + pick(component.metrics),
    0,
  );
}
