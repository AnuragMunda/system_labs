/**
 * @file simulation-engine.ts
 *
 * @description The simulation orchestrator. It drives a `SimulationRuntime`'s
 * event queue and clock to execute a simulation, but owns no state of its own
 * and knows nothing about what events mean — event semantics are the injected
 * processor's responsibility.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { EventProcessor } from "../types.js";
import { SimulationRuntime } from "./simulation-runtime.js";

/**
 * Orchestrates how a simulation executes: it reads the runtime's state (its
 * event queue and clock) to run each event, answering "how do I execute the
 * simulation?" while leaving "what state does it currently have?" to the
 * runtime. The engine stays agnostic of event semantics.
 */
export class SimulationEngine {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly eventProcessor: EventProcessor,
  ) {}

  /** Queues an event onto the runtime for future processing. */
  schedule(event: SimulationEvent): void {
    this.runtime.schedule(event);
  }

  /**
   * Drains the runtime's event queue: advances the clock to each event's
   * timestamp and invokes the processor, returning once every scheduled event
   * has run.
   */
  run(): void {
    if (this.runtime.simulation.status !== "created") {
      throw new Error(
        `Simulation cannot be run from status ${this.runtime.simulation.status}`,
      );
    }

    this.runtime.simulation.status = "running";
    this.runtime.simulation.startedAt = new Date();

    try {
      while (this.processNextEvent()) {
        // Keep processing until there is no eligible event.
      }

      this.runtime.simulation.status = "completed";
      this.runtime.simulation.completedAt = new Date();
    } catch (error) {
      this.runtime.simulation.status = "failed";
      this.runtime.simulation.completedAt = new Date();

      throw error;
    }
  }

  /**
   * Processes the next eligible event in the queue — advancing the clock to
   * its timestamp and invoking the processor — leaving the simulation
   * otherwise in place. Returns `true` when an event was processed and
   * `false` when nothing eligible remains in the queue.
   *
   * @throws If the simulation is not currently `running`.
   */
  step(): boolean {
    if (this.runtime.simulation.status !== "running") {
      throw new Error(
        `Simulation cannot be stepped from status ${this.runtime.simulation.status}`,
      );
    }

    if (!this.hasPendingEvents()) {
      this.runtime.simulation.status = "completed";
      this.runtime.simulation.completedAt = new Date();

      return false;
    }

    this.processNextEvent();

    if (!this.hasPendingEvents()) {
      this.runtime.simulation.status = "completed";
      this.runtime.simulation.completedAt = new Date();
    }

    return true;
  }

  /** Returns true when an event eligible for processing remains in the queue. */
  hasPendingEvents(): boolean {
    const nextEvent = this.runtime.eventQueue.peek();

    if (!nextEvent) {
      return false;
    }

    return nextEvent.timestampMs < this.runtime.simulation.config.durationMs;
  }

  /**
   * Processes the single earliest eligible event from the queue. An event is
   * eligible when one exists and its timestamp is earlier than the configured
   * simulation duration. Returns `true` once an event was advanced to and
   * processed.
   */
  private processNextEvent(): boolean {
    if (!this.hasPendingEvents()) {
      return false;
    }

    const event = this.runtime.eventQueue.dequeue();

    if (!event) {
      return false;
    }

    this.runtime.clock.advanceTo(event.timestampMs);
    this.eventProcessor.process(event);

    return true;
  }
}
