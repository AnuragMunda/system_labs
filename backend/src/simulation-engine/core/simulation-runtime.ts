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

  private readonly requests = new Map<string, SimulationRequest>();

  constructor(simulation: Simulation) {
    this.simulation = simulation;
    this.topology = new ArchitectureTopology(simulation.architectureSnapshot);
  }

  /** Queues an event for future processing by the engine. */
  schedule(event: SimulationEvent): void {
    this.eventQueue.enqueue(event);
  }

  /** Returns the current virtual simulation time in milliseconds. */
  get currentTimeMs(): number {
    return this.clock.now();
  }

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

  /** Rewinds the clock to zero and discards queued events for a fresh run. */
  reset(): void {
    this.clock.reset();
    this.eventQueue.clear();
    this.requests.clear();
  }
}
