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
import { ComponentRuntimeState } from "../components/component-runtime-state.js";
import { RoundRobinStrategy } from "../routing/round-robin-strategy.js";
import type { RoutingStrategy } from "../routing/routing-strategy.js";

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
  routingStrategy: RoutingStrategy = new RoundRobinStrategy();

  private readonly requests = new Map<string, SimulationRequest>();
  private readonly components = new Map<string, ComponentRuntimeState>();

  constructor(simulation: Simulation) {
    this.simulation = simulation;
    this.routingStrategy = new RoundRobinStrategy();

    this.topology = new ArchitectureTopology(simulation.architectureSnapshot);

    this.initializeComponents();
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

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initializes runtime state for every component in the
   * architecture snapshot.
   */
  private initializeComponents(): void {
    for (const node of this.simulation.architectureSnapshot.nodes) {
      this.components.set(node.id, {
        nodeId: node.id,
        health: node.config.health ?? "healthy",
        activeRequests: 0,
        processedRequests: 0,
      });
    }
  }

  /** Resets the simulation runtime to its initial state. */
  reset(): void {
    this.clock.reset();
    this.eventQueue.clear();

    this.routingStrategy = new RoundRobinStrategy();

    this.requests.clear();
    this.components.clear();

    this.initializeComponents();
  }
}
