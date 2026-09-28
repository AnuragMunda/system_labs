/**
 * @file simulation-runtime.ts
 *
 * @description Owns the runtime state of a single simulation: the `Simulation`
 * being run together with its virtual clock and event queue. The runtime
 * answers "what state does this simulation currently have?" while the engine
 * orchestrates how that state is executed.
 */

import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationClock } from "./simulation-clock.js";
import { EventQueue } from "./event-queue.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { SimulationRequest } from "@/domain/simulation/request.types.js";
import { ArchitectureTopology } from "../topology/architecture-topology.js";
import { SimulationRandom } from "../random/simulation-random.js";
import { ComponentRequestQueue } from "../capacity/component-request-queue.js";
import { createRoutingStrategy } from "../routing/routing-strategy.factory.js";
import { ComponentHealthEvaluator } from "../components/health/component-health-evaluator.js";
import {
  CircuitArrivalStatus,
  CircuitFailureRecord,
  ComponentCircuitBreakerState,
  ComponentHealthStateChange,
  ComponentRuntimeMetrics,
  ComponentRuntimeState,
  QueueAdmissionResult,
  RoutingContext,
  RoutingStrategy,
} from "../utils/types.js";
import {
  DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_CIRCUIT_OPEN_DURATION_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_HEALTH_THRESHOLDS,
  DEFAULT_REPLICAS,
} from "../utils/constants.js";
import {
  getEffectiveConcurrency,
  resolveCircuitBreakerConfig,
} from "../utils/helpers.js";
import { SimulationCache } from "../cache/simulation-cache.js";
import { LatencyHistogram } from "../metrics/latency-histogram.js";
import {
  MetricsSnapshotSource,
  buildSimulationMetrics,
} from "../metrics/metrics-snapshot.js";
import { SimulationMetrics } from "@/domain/simulation/metrics.types.js";
import { DatabaseOperation } from "@/domain/simulation/request.types.js";

/**
 * Simulation-level metrics observations that cannot be derived from the
 * request map or a component's runtime state. Populated only when metrics
 * collection is enabled.
 */
export interface RuntimeMetricsStore {
  failureByReason: Record<string, number>;
  failureByNode: Record<string, number>;
  retriesByNode: Record<string, number>;
  totalRetries: number;
  transmissions: number;
  packetLosses: number;
  networkLatency: LatencyHistogram;
  dbOperations: Record<string, { read: number; write: number }>;
}

export function createMetricsStore(): RuntimeMetricsStore {
  return {
    failureByReason: {},
    failureByNode: {},
    retriesByNode: {},
    totalRetries: 0,
    transmissions: 0,
    packetLosses: 0,
    networkLatency: new LatencyHistogram(),
    dbOperations: {},
  };
}

/**
 * Builds the zeroed per-component observability state for a component that is
 * being initialized with the given replica count.
 */
export function createComponentMetrics(
  replicas: number,
): ComponentRuntimeMetrics {
  return {
    peakActiveRequests: 0,
    peakQueueDepth: 0,
    totalEnqueued: 0,
    totalDequeued: 0,
    totalDropped: 0,
    totalRejected: 0,
    queueWait: new LatencyHistogram(),
    healthTransitions: 0,
    healthFailureCount: 0,
    healthRecoveryCount: 0,
    timeInStateMs: { healthy: 0, degraded: 0, critical: 0, failed: 0 },
    lastHealthTransitionAtMs: 0,
    initialReplicas: replicas,
    minimumReplicas: replicas,
    maximumReplicas: replicas,
    scaleUpCount: 0,
    scaleDownCount: 0,
    autoscalingEvaluationCount: 0,
    processingLatency: new LatencyHistogram(),
  };
}

/** A processed-request reason string, used to key the failure-by-reason map. */
export type FailureReason = string;

/**
 * Holds the mutable state for one simulation run — the simulation itself, its
 * monotonic clock, and its pending event queue. A fresh instance is created
 * per simulation/run.
 */
export class SimulationRuntime {
  readonly simulation: Simulation;
  readonly topology: ArchitectureTopology;
  readonly clock: SimulationClock = new SimulationClock();
  readonly eventQueue: EventQueue = new EventQueue();
  readonly componentRequestQueue: ComponentRequestQueue =
    new ComponentRequestQueue();
  random: SimulationRandom;
  /** Evaluates component health from runtime counters and configured thresholds. */
  readonly healthEvaluator = new ComponentHealthEvaluator();

  private readonly requests = new Map<string, SimulationRequest>();
  private readonly components = new Map<string, ComponentRuntimeState>();
  private readonly routingStrategies = new Map<string, RoutingStrategy>();
  private readonly caches = new Map<string, SimulationCache>();

  /**
   * Simulation-level observability counters that have no natural home on a
   * component. Request success/failure counts and end-to-end latencies are
   * derived from the request map at snapshot time; only observations that are
   * not recoverable from the request map are stored here.
   */
  private metricsStore = createMetricsStore();

  constructor(simulation: Simulation) {
    this.simulation = simulation;
    this.random = new SimulationRandom(simulation.seed);

    this.topology = new ArchitectureTopology(simulation.architectureSnapshot);

    this.initializeComponents();
    this.initializeRoutingStrategies();
    this.initializeCaches();
  }

  /** Queues an event for future processing by the engine. */
  schedule(event: SimulationEvent): void {
    this.eventQueue.enqueue(event);
  }

  /** Returns the current virtual simulation time in milliseconds. */
  get currentTimeMs(): number {
    return this.clock.now();
  }

  /**
   * Whether observability metrics are being collected. When false, recording is
   * skipped entirely and {@link getMetrics} returns a zeroed snapshot.
   */
  get metricsEnabled(): boolean {
    return this.simulation.config.collectMetrics;
  }

  // ---------------------------------------------------------------------------
  // METRICS
  // ---------------------------------------------------------------------------

  /**
   * Records that a request permanently failed on a component, keyed by reason
   * and (where known) the failing node.
   */
  recordRequestFailure(reason: string, nodeId?: string): void {
    if (!this.metricsEnabled) return;

    this.metricsStore.failureByReason[reason] =
      (this.metricsStore.failureByReason[reason] ?? 0) + 1;

    if (nodeId) {
      this.metricsStore.failureByNode[nodeId] =
        (this.metricsStore.failureByNode[nodeId] ?? 0) + 1;
    }
  }

  /**
   * Records that a request was retried after a failure on the given node.
   */
  recordRetry(nodeId: string): void {
    if (!this.metricsEnabled) return;

    this.metricsStore.retriesByNode[nodeId] =
      (this.metricsStore.retriesByNode[nodeId] ?? 0) + 1;
    this.metricsStore.totalRetries++;
  }

  /**
   * Records a network transmission: either a delivered (success) message or a
   * dropped (packet loss) message. The inter-component delay is sampled into
   * the network latency histogram when the message is delivered.
   */
  recordNetworkTransmission(dropped: boolean, latencyMs: number): void {
    if (!this.metricsEnabled) return;

    this.metricsStore.transmissions++;

    if (dropped) {
      this.metricsStore.packetLosses++;
      return;
    }

    this.metricsStore.networkLatency.record(latencyMs);
  }

  /**
   * Records a database operation performed by a database node.
   */
  recordDatabaseOperation(nodeId: string, operation: DatabaseOperation): void {
    if (!this.metricsEnabled) return;

    const entry = this.metricsStore.dbOperations[nodeId] ?? {
      read: 0,
      write: 0,
    };

    if (operation === "write") {
      entry.write++;
    } else {
      entry.read++;
    }

    this.metricsStore.dbOperations[nodeId] = entry;
  }

  /**
   * Returns every request in the simulation, in insertion order.
   */
  getAllRequests(): SimulationRequest[] {
    return Array.from(this.requests.values());
  }

  /**
   * Builds the immutable metrics snapshot for the simulation at the current
   * virtual time. The snapshot is deeply frozen; callers must not mutate it.
   */
  getMetrics(): SimulationMetrics {
    const source: MetricsSnapshotSource = {
      collectMetrics: this.metricsEnabled,
      simulationId: this.simulation.id,
      durationMs: this.simulation.config.durationMs,
      processedDurationMs: this.clock.now(),
      requests: Array.from(this.requests.values()),
      components: Array.from(this.components.values()),
      nodeTypes: new Map(
        this.simulation.architectureSnapshot.nodes.map((node) => [
          node.id,
          node.type,
        ]),
      ),
      autoscalingEnabled: new Map(
        this.simulation.architectureSnapshot.nodes.map((node) => [
          node.id,
          node.config.autoscaling?.enabled === true,
        ]),
      ),
      queueDepths: new Map(
        Array.from(this.components.keys()).map((nodeId) => [
          nodeId,
          this.componentRequestQueue.size(nodeId),
        ]),
      ),
      cacheNodes: Array.from(this.caches.entries()).map(([nodeId, cache]) => ({
        nodeId,
        hits: cache.hits,
        misses: cache.misses,
        evictions: cache.evictions,
        currentEntries: cache.size,
        maxEntries: cache.maxEntries,
      })),
      dbOperations: this.metricsStore.dbOperations,
      failureByReason: this.metricsStore.failureByReason,
      failureByNode: this.metricsStore.failureByNode,
      retriesByNode: this.metricsStore.retriesByNode,
      totalRetries: this.metricsStore.totalRetries,
      transmissions: this.metricsStore.transmissions,
      packetLosses: this.metricsStore.packetLosses,
      networkSummary: this.metricsStore.networkLatency.summary(),
    };

    return buildSimulationMetrics(source);
  }

  // ---------------------------------------------------------------------------
  // REQUESTS
  // ---------------------------------------------------------------------------

  createRequest(request: SimulationRequest): void {
    if (this.requests.has(request.id))
      throw new Error(`Request already exists ${request.id}`);

    this.requests.set(request.id, request);
  }

  getRequest(id: string): SimulationRequest {
    const request = this.requests.get(id);

    if (!request) throw new Error(`Request not found ${id}`);

    return request;
  }

  updateRequest(id: string, newData: Partial<SimulationRequest>): void {
    const request = this.getRequest(id);
    this.requests.set(id, { ...request, ...newData });
  }

  // ---------------------------------------------------------------------------
  // COMPONENTS
  // ---------------------------------------------------------------------------

  getComponent(nodeId: string): ComponentRuntimeState {
    const component = this.components.get(nodeId);

    if (!component) {
      throw new Error(`Component not found: ${nodeId}`);
    }

    return component;
  }

  updateComponent(
    nodeId: string,
    newData: Partial<ComponentRuntimeState>,
  ): void {
    const component = this.getComponent(nodeId);

    this.components.set(nodeId, {
      ...component,
      ...newData,
    });
  }

  /**
   * Increments the number of requests currently being processed
   * by the component.
   */
  incrementActiveRequests(nodeId: string): void {
    const component = this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      activeRequests: component.activeRequests + 1,
    });

    if (this.metricsEnabled) {
      this.updateComponentMetrics(nodeId, {
        peakActiveRequests: Math.max(
          component.metrics.peakActiveRequests,
          component.activeRequests + 1,
        ),
      });
    }
  }

  /**
   * Decrements the number of requests currently being processed
   * by the component.
   */
  decrementActiveRequests(nodeId: string): void {
    const component = this.getComponent(nodeId);

    if (component.activeRequests <= 0) {
      throw new Error(
        `Component ${nodeId} has no active requests to decrement.`,
      );
    }

    this.updateComponent(nodeId, {
      activeRequests: component.activeRequests - 1,
    });
  }

  /**
   * Records a successfully processed request.
   */
  recordProcessedRequest(nodeId: string): void {
    const component = this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      processedRequests: component.processedRequests + 1,
    });
  }

  /**
   * Records that a component started processing a request (success or failure).
   */
  recordProcessingAttempt(nodeId: string): void {
    const component = this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      totalProcessingAttempts: component.totalProcessingAttempts + 1,
    });
  }

  /**
   * Records that a processing attempt failed (errorRate-driven).
   */
  recordProcessingFailure(nodeId: string): void {
    const component = this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      failedProcessingAttempts: component.failedProcessingAttempts + 1,
    });
  }

  /**
   * Records the processing latency of a completed request, both cumulatively
   * and as the most recent value.
   *
   * @throws If the latency is negative.
   */
  recordProcessingLatency(nodeId: string, latencyMs: number): void {
    if (latencyMs < 0) {
      throw new Error(`Processing latency cannot be negative: ${latencyMs}`);
    }

    const component = this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      totalProcessingLatencyMs: component.totalProcessingLatencyMs + latencyMs,

      lastProcessingLatencyMs: latencyMs,
    });

    if (this.metricsEnabled) {
      component.metrics.processingLatency.record(latencyMs);
    }
  }

  /**
   * Recomputes a component's health from its runtime counters using the health
   * thresholds declared on its node config (or the defaults). Components that
   * were explicitly failed stay failed until a component.recovered event; a
   * non-failed component can return to healthy when its metrics improve.
   *
   * Returns `{ previousHealth, health }` when the health state actually
   * changed, or `undefined` when it did not (including explicitly failed
   * components, which are never mutated by automatic evaluation).
   */
  evaluateComponentHealth(
    nodeId: string,
  ): ComponentHealthStateChange | undefined {
    const component = this.getComponent(nodeId);

    // Explicitly failed components remain failed until
    // an explicit recovery event occurs.
    if (component.health === "failed") {
      return undefined;
    }

    const node = this.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const thresholds =
      node.config.healthThresholds ?? DEFAULT_HEALTH_THRESHOLDS;

    const health = this.healthEvaluator.evaluate(component, thresholds);

    if (health === component.health) {
      return undefined;
    }

    const previousHealth = component.health;

    this.updateComponent(nodeId, {
      health,
    });

    this.observeHealthTransition(nodeId, previousHealth, health);

    return {
      previousHealth,
      health,
    };
  }

  /**
   * Changes a component's health state.
   *
   * This method only updates runtime state. Event creation remains the
   * responsibility of the event processor.
   */
  setComponentHealth(
    nodeId: string,
    health: ComponentRuntimeState["health"],
  ): void {
    const previousHealth = this.getComponent(nodeId).health;

    this.updateComponent(nodeId, {
      health,
    });

    this.observeHealthTransition(nodeId, previousHealth, health);
  }

  /**
   * Starts a new recovery cycle for a component and returns its generation.
   *
   * Incrementing the generation invalidates any previously scheduled recovery
   * event for this component.
   */
  startRecoveryCycle(nodeId: string): number {
    const component = this.getComponent(nodeId);

    const recoveryGeneration = component.recoveryGeneration + 1;

    this.updateComponent(nodeId, {
      recoveryGeneration,
    });

    return recoveryGeneration;
  }

  /**
   * Returns the current recovery generation for a component.
   */
  getRecoveryGeneration(nodeId: string): number {
    return this.getComponent(nodeId).recoveryGeneration;
  }

  // ---------------------------------------------------------------------------
  // CIRCUIT BREAKER
  // ---------------------------------------------------------------------------

  /**
   * Returns the mutable circuit-breaker state for a component.
   */
  getCircuitState(nodeId: string): ComponentCircuitBreakerState {
    return this.getComponent(nodeId).circuit;
  }

  /**
   * Determines whether a request arriving at a component may proceed given the
   * component's circuit state.
   *
   * @returns "open" - the circuit is open; the request must fail fast.
   * @returns "probe-busy" - the circuit is half-open and another probe is in
   *   flight; the request must fail fast.
   * @returns "admitted" - the request may proceed (this includes the in-flight
   *   probe itself and any request to a disabled/closed circuit).
   */
  admitArrival(nodeId: string, requestId: string): CircuitArrivalStatus {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled) {
      return "admitted";
    }

    if (circuit.state === "open") {
      return "open";
    }

    if (circuit.state === "half-open") {
      if (circuit.probeInFlight && circuit.probeRequestId !== requestId) {
        return "probe-busy";
      }

      if (!circuit.probeInFlight) {
        this.updateComponent(nodeId, {
          circuit: {
            ...circuit,
            probeInFlight: true,
            probeRequestId: requestId,
          },
        });
      }

      return "admitted";
    }

    return "admitted";
  }

  /**
   * Returns true when the component's circuit is currently open.
   */
  isCircuitOpen(nodeId: string): boolean {
    return this.getCircuitState(nodeId).state === "open";
  }

  /**
   * Returns whether a request may be routed toward the component from its
   * circuit's perspective. A half-open circuit with a probe already in flight
   * is not routable; all others (closed, disabled, or a free half-open) are.
   */
  isCircuitRoutable(nodeId: string): boolean {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled) {
      return true;
    }

    return (
      circuit.state === "closed" ||
      (circuit.state === "half-open" && !circuit.probeInFlight)
    );
  }

  /**
   * Records a retryable failure against a component's circuit. When the
   * consecutive failure count reaches the threshold the circuit opens and its
   * generation increments (invalidating stale recovery timers).
   *
   * Returns `undefined` when the component has no enabled breaker; otherwise a
   * {@link CircuitFailureRecord} describing whether the circuit just opened.
   */
  recordCircuitFailure(nodeId: string): CircuitFailureRecord | undefined {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled) {
      return undefined;
    }

    if (circuit.state === "open") {
      // A straggler failing while the circuit is already open must not
      // disturb the trip or schedule duplicate recovery timers.
      return {
        opened: false,
        consecutiveFailures: circuit.consecutiveFailures,
        failureThreshold: circuit.failureThreshold,
        generation: circuit.generation,
      };
    }

    const consecutiveFailures = circuit.consecutiveFailures + 1;

    if (consecutiveFailures < circuit.failureThreshold) {
      this.updateComponent(nodeId, {
        circuit: { ...circuit, consecutiveFailures },
      });

      return {
        opened: false,
        consecutiveFailures,
        failureThreshold: circuit.failureThreshold,
        generation: circuit.generation,
      };
    }

    const openedAtMs = this.currentTimeMs;

    this.updateComponent(nodeId, {
      circuit: {
        ...circuit,
        state: "open",
        consecutiveFailures,
        openedAtMs,
        generation: circuit.generation + 1,
        probeInFlight: false,
        probeRequestId: undefined,
      },
    });

    return {
      opened: true,
      consecutiveFailures,
      failureThreshold: circuit.failureThreshold,
      openedAtMs,
      generation: circuit.generation + 1,
    };
  }

  /**
   * Resets a component's consecutive failure count after a successful
   * execution. A success while half-open closes the circuit (the half-open
   * probe succeeded).
   *
   * @returns `true` when the success closed an open circuit.
   */
  resetCircuit(nodeId: string): boolean {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled || circuit.state === "open") {
      return false;
    }

    if (circuit.state === "half-open") {
      this.closeCircuit(nodeId);
      return true;
    }

    if (circuit.consecutiveFailures === 0) {
      return false;
    }

    this.updateComponent(nodeId, {
      circuit: { ...circuit, consecutiveFailures: 0 },
    });

    return false;
  }

  /**
   * Closes a component's circuit, clearing failure counts and any probe.
   */
  closeCircuit(nodeId: string): void {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled) {
      return;
    }

    this.updateComponent(nodeId, {
      circuit: {
        ...circuit,
        state: "closed",
        consecutiveFailures: 0,
        openedAtMs: undefined,
        probeInFlight: false,
        probeRequestId: undefined,
      },
    });
  }

  /**
   * Returns whether the given request currently owns the component's half-open
   * probe.
   */
  isCircuitProbe(nodeId: string, requestId: string): boolean {
    const circuit = this.getCircuitState(nodeId);

    return (
      circuit.enabled &&
      circuit.state === "half-open" &&
      circuit.probeInFlight &&
      circuit.probeRequestId === requestId
    );
  }

  /**
   * Releases an in-flight half-open probe without changing the circuit state.
   * Used when a probe terminates while the circuit stays half-open.
   */
  releaseProbe(nodeId: string): void {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled) {
      return;
    }

    this.updateComponent(nodeId, {
      circuit: {
        ...circuit,
        probeInFlight: false,
        probeRequestId: undefined,
      },
    });
  }

  /**
   * Moves an open circuit to half-open, allowing a single probe request when
   * the open duration elapses. The transition is generation-guarded so a stale
   * scheduled event can never mutate a newer circuit cycle.
   *
   * @returns `true` when the transition happened; `false` when it was stale.
   */
  transitionToHalfOpen(nodeId: string, generation: number): boolean {
    const circuit = this.getCircuitState(nodeId);

    if (!circuit.enabled) {
      return false;
    }

    if (circuit.state !== "open" || circuit.generation !== generation) {
      return false;
    }

    this.updateComponent(nodeId, {
      circuit: {
        ...circuit,
        state: "half-open",
        probeInFlight: false,
        probeRequestId: undefined,
      },
    });

    return true;
  }

  /**
   * Updates the current runtime replica count for a component.
   *
   * The configured replica count remains the initial replica count;
   * this value represents the current simulated replica count.
   */
  setComponentReplicas(nodeId: string, replicas: number): void {
    if (!Number.isInteger(replicas) || replicas < 1) {
      throw new Error(
        `Component replicas must be a positive integer: ${replicas}`,
      );
    }

    const node = this.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const previousReplicas = this.getComponent(nodeId).replicas;

    const concurrency = node.config.concurrency ?? DEFAULT_CONCURRENCY;

    this.updateComponent(nodeId, {
      replicas,
      effectiveConcurrency: getEffectiveConcurrency(replicas, concurrency),
    });

    if (this.metricsEnabled) {
      const component = this.getComponent(nodeId);

      const scaleUpCount =
        component.metrics.scaleUpCount + (replicas > previousReplicas ? 1 : 0);
      const scaleDownCount =
        component.metrics.scaleDownCount +
        (replicas < previousReplicas ? 1 : 0);

      this.updateComponentMetrics(nodeId, {
        minimumReplicas: Math.min(component.metrics.minimumReplicas, replicas),
        maximumReplicas: Math.max(component.metrics.maximumReplicas, replicas),
        scaleUpCount,
        scaleDownCount,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // ROUTING
  // ---------------------------------------------------------------------------

  /**
   * Returns the routing strategy configured for a node, or throws if none is
   * configured.
   */
  getRoutingStrategy(nodeId: string): RoutingStrategy {
    const strategy = this.routingStrategies.get(nodeId);

    if (!strategy) {
      throw new Error(`Routing strategy not configured for node: ${nodeId}`);
    }

    return strategy;
  }

  /**
   * Builds a {@link RoutingContext} for a given source node and request,
   * supplying the shared RNG and the active-request-count lookup.
   */
  getRoutingContext(sourceNodeId: string, requestId: string): RoutingContext {
    return {
      sourceNodeId,
      requestId,
      random: this.random,
      getActiveRequestCount: (nodeId: string) =>
        this.getActiveRequestCount(nodeId),
    };
  }

  // ---------------------------------------------------------------------------
  // COMPONENT REQUEST QUEUE
  // ---------------------------------------------------------------------------

  /**
   * Attempts to append a request to the back of the given component's queue.
   *
   * @param nodeId    - The component node identifier; must exist in the
   *   topology.
   * @param requestId - The request to enqueue.
   * @returns The admission result describing the outcome.
   * @throws {Error} If `nodeId` is not in the topology, or `maxSize` is not a
   *   non-negative integer.
   */
  enqueueRequest(nodeId: string, requestId: string): QueueAdmissionResult {
    const node = this.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const queueConfig = node.config.queue;

    if (queueConfig?.enabled === false) {
      this.recordQueueRejection(nodeId);

      return {
        admitted: false,
        reason: "queue_disabled",
      };
    }

    const maxSize = queueConfig?.maxSize;

    if (maxSize !== undefined && (!Number.isInteger(maxSize) || maxSize < 0)) {
      throw new Error(
        `Queue maxSize must be a non-negative integer: ${maxSize}`,
      );
    }

    const currentSize = this.getQueuedRequestCount(nodeId);

    if (maxSize !== undefined && currentSize >= maxSize) {
      const overflowStrategy = queueConfig?.overflowStrategy ?? "reject";

      if (overflowStrategy === "reject") {
        this.recordQueueRejection(nodeId);

        return {
          admitted: false,
          reason: "queue_full",
        };
      }

      if (overflowStrategy === "drop_oldest") {
        const droppedRequestId = this.dequeueRequest(nodeId);

        if (!droppedRequestId) {
          throw new Error(
            `Queue ${nodeId} reported full but contained no request.`,
          );
        }

        this.componentRequestQueue.enqueue(nodeId, requestId);
        this.recordQueueAdmission(nodeId, requestId, true);

        return {
          admitted: true,
          droppedRequestId,
        };
      }
    }

    this.componentRequestQueue.enqueue(nodeId, requestId);
    this.recordQueueAdmission(nodeId, requestId);

    return {
      admitted: true,
    };
  }

  /** Remove and return the next request from a component's queue, or `undefined` if empty. */
  dequeueRequest(nodeId: string): string | undefined {
    const requestId = this.componentRequestQueue.dequeue(nodeId);

    if (requestId === undefined || !this.metricsEnabled) {
      return requestId;
    }

    const component = this.getComponent(nodeId);

    this.updateComponentMetrics(nodeId, {
      totalDequeued: component.metrics.totalDequeued + 1,
    });

    const request = this.requests.get(requestId);

    if (request?.queuedAtMs !== undefined) {
      component.metrics.queueWait.record(
        this.currentTimeMs - request.queuedAtMs,
      );
      this.updateRequest(requestId, { queuedAtMs: undefined });
    }

    return requestId;
  }

  /** Return the number of requests waiting in a component's queue. */
  getQueuedRequestCount(nodeId: string): number {
    return this.componentRequestQueue.size(nodeId);
  }

  // ---------------------------------------------------------------------------
  // CACHE
  // ---------------------------------------------------------------------------

  /**
   * Returns the cache associated with a cache node.
   */
  getCache(nodeId: string): SimulationCache {
    const cache = this.caches.get(nodeId);

    if (!cache) {
      throw new Error(`Cache not configured for node: ${nodeId}`);
    }

    return cache;
  }

  /**
   * Returns true when the node is configured as a cache and has
   * runtime cache state.
   */
  isCacheNode(nodeId: string): boolean {
    return this.caches.has(nodeId);
  }

  /**
   * Looks up a cache entry using the current simulation time.
   */
  getCacheEntry(
    nodeId: string,
    key: string,
  ): ReturnType<SimulationCache["get"]> {
    return this.getCache(nodeId).get(key, this.currentTimeMs);
  }

  /**
   * Stores a value in a component's cache.
   */
  setCacheEntry(nodeId: string, key: string, value: unknown): void {
    this.getCache(nodeId).set(key, value, this.currentTimeMs);
  }

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  /**
   * Initializes runtime state for every component in the
   * architecture snapshot.
   *
   * The effective concurrency comes from the snapshot's config rather than
   * {@link getEffectiveConcurrency}, which reads component runtime state that
   * does not exist yet while components are still being registered.
   */
  private initializeComponents(): void {
    for (const node of this.simulation.architectureSnapshot.nodes) {
      const replicas = node.config.replicas ?? DEFAULT_REPLICAS;
      const concurrency = node.config.concurrency ?? DEFAULT_CONCURRENCY;
      const circuitConfig = resolveCircuitBreakerConfig(
        node.config.retryPolicy,
      );

      this.components.set(node.id, {
        nodeId: node.id,
        health: node.config.health ?? "healthy",
        activeRequests: 0,
        processedRequests: 0,
        totalProcessingAttempts: 0,
        failedProcessingAttempts: 0,
        totalProcessingLatencyMs: 0,
        replicas,
        effectiveConcurrency: getEffectiveConcurrency(replicas, concurrency),
        recoveryGeneration: 0,
        metrics: createComponentMetrics(replicas),
        circuit: {
          enabled: circuitConfig.enabled ?? false,
          failureThreshold:
            circuitConfig.failureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
          openDurationMs:
            circuitConfig.openDurationMs ?? DEFAULT_CIRCUIT_OPEN_DURATION_MS,
          state: "closed",
          consecutiveFailures: 0,
          generation: 0,
          probeInFlight: false,
        },
      });
    }
  }

  /**
   * Creates a {@link RoutingStrategy} instance for every node that declares a
   * `routingStrategy` in its config.
   */
  private initializeRoutingStrategies(): void {
    this.routingStrategies.clear();

    for (const node of this.simulation.architectureSnapshot.nodes) {
      const strategyType = node.config.routingStrategy;

      if (!strategyType) {
        continue;
      }

      this.routingStrategies.set(node.id, createRoutingStrategy(strategyType));
    }
  }

  private initializeCaches(): void {
    this.caches.clear();

    for (const node of this.simulation.architectureSnapshot.nodes) {
      if (node.type !== "cache") {
        continue;
      }

      const config = node.config.cache;

      if (!config) {
        continue;
      }

      this.caches.set(
        node.id,
        new SimulationCache(config.capacity, config.ttlMs),
      );
    }
  }

  /** Resets the simulation runtime to its initial state. */
  reset(): void {
    this.clock.reset();
    this.eventQueue.clear();

    this.random = new SimulationRandom(this.simulation.seed);

    this.requests.clear();
    this.components.clear();
    this.componentRequestQueue.clear();
    this.routingStrategies.clear();
    this.metricsStore = createMetricsStore();

    this.initializeComponents();
    this.initializeRoutingStrategies();
    this.initializeCaches();
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Merges a patch into a component's metrics observability state.
   */
  private updateComponentMetrics(
    nodeId: string,
    patch: Partial<ComponentRuntimeMetrics>,
  ): void {
    const component = this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      metrics: {
        ...component.metrics,
        ...patch,
      },
    });
  }

  /**
   * Records that an admitted request entered a component's queue, stamps its
   * enqueue time, and tracks the observed peak queue depth.
   */
  private recordQueueAdmission(
    nodeId: string,
    requestId: string,
    droppedOldest = false,
  ): void {
    if (!this.metricsEnabled) return;

    const component = this.getComponent(nodeId);

    this.updateComponentMetrics(nodeId, {
      totalEnqueued: component.metrics.totalEnqueued + 1,
      totalDropped: component.metrics.totalDropped + (droppedOldest ? 1 : 0),
      peakQueueDepth: Math.max(
        component.metrics.peakQueueDepth,
        this.getQueuedRequestCount(nodeId),
      ),
    });

    // The stamp is only meaningful for requests the runtime actually tracks;
    // low-level queue callers may enqueue a raw id without a request record.
    const request = this.requests.get(requestId);

    if (request) {
      this.requests.set(requestId, {
        ...request,
        queuedAtMs: this.currentTimeMs,
      });
    }
  }

  /**
   * Records that a request was rejected from a component's queue.
   */
  private recordQueueRejection(nodeId: string): void {
    if (!this.metricsEnabled) return;

    const component = this.getComponent(nodeId);

    this.updateComponentMetrics(nodeId, {
      totalRejected: component.metrics.totalRejected + 1,
    });
  }

  /**
   * Records a health state transition, crediting the elapsed virtual time to
   * the previous state and counting the transition.
   */
  private observeHealthTransition(
    nodeId: string,
    previousHealth: ComponentRuntimeState["health"],
    health: ComponentRuntimeState["health"],
  ): void {
    if (!this.metricsEnabled || previousHealth === health) return;

    const component = this.getComponent(nodeId);
    const timeInStateMs = { ...component.metrics.timeInStateMs };

    timeInStateMs[previousHealth] +=
      this.currentTimeMs - component.metrics.lastHealthTransitionAtMs;

    this.updateComponentMetrics(nodeId, {
      healthTransitions: component.metrics.healthTransitions + 1,
      healthFailureCount:
        component.metrics.healthFailureCount + (health === "failed" ? 1 : 0),
      healthRecoveryCount:
        component.metrics.healthRecoveryCount +
        (previousHealth === "failed" ? 1 : 0),
      timeInStateMs,
      lastHealthTransitionAtMs: this.currentTimeMs,
    });
  }

  /**
   * Records that an `autoscaling.evaluate` event was resolved for a component.
   */
  recordAutoscalingEvaluation(nodeId: string): void {
    if (!this.metricsEnabled) return;

    const component = this.getComponent(nodeId);

    this.updateComponentMetrics(nodeId, {
      autoscalingEvaluationCount:
        component.metrics.autoscalingEvaluationCount + 1,
    });
  }

  /**
   * Returns the number of active (in-flight) requests for a node, or `0` if
   * the node has no runtime state.
   */
  getActiveRequestCount(nodeId: string): number {
    return this.components.get(nodeId)?.activeRequests ?? 0;
  }

  /**
   * Calculates the effective concurrency for a node based on its configuration.
   * This is the maximum number of requests that can be processed concurrently
   * by the node.
   */
  getEffectiveConcurrency(nodeId: string): number {
    const node = this.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}.`);
    }

    const component = this.getComponent(nodeId);
    const concurrency = node.config.concurrency ?? DEFAULT_CONCURRENCY;

    return getEffectiveConcurrency(component.replicas, concurrency);
  }

  /**
   * Determines if a node has capacity to process more requests based on its
   * effective concurrency and the number of active requests.
   */
  hasCapacity(nodeId: string): boolean {
    const activeRequests = this.getActiveRequestCount(nodeId);
    const effectiveConcurrency = this.getEffectiveConcurrency(nodeId);

    return activeRequests < effectiveConcurrency;
  }

  isNodeAvailable(nodeId: string): boolean {
    const component = this.getComponent(nodeId);

    return component.health !== "failed";
  }

  /**
   * Returns true when the node is a database component. Database nodes receive
   * database operations (`database.request` / `database.response`) instead of
   * generic processing and routing when a request is routed to them.
   */
  isDatabaseNode(nodeId: string): boolean {
    return this.topology.getNode(nodeId)?.type === "database";
  }
}
