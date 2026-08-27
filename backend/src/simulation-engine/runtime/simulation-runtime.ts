/**
 * @file simulation-runtime.ts
 *
 * @description Owns the runtime state of a single simulation: the `Simulation`
 * being run together with its virtual clock and event queue. The runtime
 * answers "what state does this simulation currently have?" while the engine
 * orchestrates how that state is executed.
 */

import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationClock } from "../core/simulation-clock.js";
import { EventQueue } from "../core/event-queue.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";

/**
 * Holds the mutable state for one simulation run — the simulation itself, its
 * monotonic clock, and its pending event queue. A fresh instance is created
 * per simulation/run.
 */
export class SimulationRuntime {
  readonly simulation: Simulation;
  readonly clock: SimulationClock;
  readonly eventQueue: EventQueue;

  constructor(simulation: Simulation) {
    this.simulation = simulation;
    this.clock = new SimulationClock();
    this.eventQueue = new EventQueue();
  }

  /** Queues an event for future processing by the engine. */
  schedule(event: SimulationEvent): void {
    this.eventQueue.enqueue(event);
  }

  /** Returns the current virtual simulation time in milliseconds. */
  get currentTimeMs(): number {
    return this.clock.now();
  }

  /** Rewinds the clock to zero and discards queued events for a fresh run. */
  reset(): void {
    this.clock.reset();
    this.eventQueue.clear();
  }
}
