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
  ComponentHealthStateChange,
  ComponentRuntimeState,
  QueueAdmissionResult,
  RoutingContext,
  RoutingStrategy,
} from "../utils/types.js";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_HEALTH_THRESHOLDS,
  DEFAULT_REPLICAS,
} from "../utils/constants.js";
import { getEffectiveConcurrency } from "../utils/helpers.js";
import { SimulationCache } from "../cache/simulation-cache.js";

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
  readonly random: SimulationRandom;
  /** Evaluates component health from runtime counters and configured thresholds. */
  readonly healthEvaluator = new ComponentHealthEvaluator();

  private readonly requests = new Map<string, SimulationRequest>();
  private readonly components = new Map<string, ComponentRuntimeState>();
  private readonly routingStrategies = new Map<string, RoutingStrategy>();
  private readonly caches = new Map<string, SimulationCache>();

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
    this.getComponent(nodeId);

    this.updateComponent(nodeId, {
      health,
    });
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

    const concurrency = node.config.concurrency ?? DEFAULT_CONCURRENCY;

    this.updateComponent(nodeId, {
      replicas,
      effectiveConcurrency: getEffectiveConcurrency(replicas, concurrency),
    });
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

        return {
          admitted: true,
          droppedRequestId,
        };
      }
    }

    this.componentRequestQueue.enqueue(nodeId, requestId);

    return {
      admitted: true,
    };
  }

  /** Remove and return the next request from a component's queue, or `undefined` if empty. */
  dequeueRequest(nodeId: string): string | undefined {
    return this.componentRequestQueue.dequeue(nodeId);
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

    this.requests.clear();
    this.components.clear();
    this.componentRequestQueue.clear();
    this.routingStrategies.clear();

    this.initializeComponents();
    this.initializeRoutingStrategies();
    this.initializeCaches();
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

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
}
