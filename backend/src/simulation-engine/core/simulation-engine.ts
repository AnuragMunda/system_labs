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
import { TrafficGenerator } from "./traffic-generator.js";

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
    private readonly trafficGenerator: TrafficGenerator,
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
    this.start();

    try {
      this.execute();

      if (this.runtime.simulation.status === "running") {
        this.complete();
      }
    } catch (error) {
      this.fail();

      throw error;
    }
  }

  /**
   * Transitions a created simulation into the `running` state and records when
   * it started. It does not process any events.
   *
   * @throws If the simulation is not currently `created`.
   */
  start(): void {
    if (this.runtime.simulation.status !== "created") {
      throw new Error(
        `Simulation cannot be started from status ${this.runtime.simulation.status}`,
      );
    }

    this.runtime.simulation.status = "running";
    this.runtime.simulation.startedAt = new Date();
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
      this.complete();
      return false;
    }

    this.processNextEvent();

    if (!this.hasPendingEvents()) {
      this.complete();
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

  /** Pauses a running simulation, halting further event processing. */
  pause(): void {
    if (this.runtime.simulation.status !== "running") {
      throw new Error(
        `Simulation cannot be paused from status ${this.runtime.simulation.status}`,
      );
    }

    this.runtime.simulation.status = "paused";
  }

  /** Resumes a paused simulation so event processing can continue. */
  resume(): void {
    if (this.runtime.simulation.status !== "paused") {
      throw new Error(
        `Simulation cannot be resumed from status ${this.runtime.simulation.status}`,
      );
    }

    this.runtime.simulation.status = "running";
  }

  /**
   * Cancels a running or paused simulation, marking it cancelled and
   * recording when it ended.
   */
  cancel(): void {
    if (
      this.runtime.simulation.status !== "running" &&
      this.runtime.simulation.status !== "paused"
    ) {
      throw new Error(
        `Simulation cannot be cancelled from status ${this.runtime.simulation.status}`,
      );
    }

    this.runtime.simulation.status = "cancelled";
    this.runtime.simulation.completedAt = new Date();
  }

  /**
   * Pre-generates the simulation's initial request load for the given source
   * node, delegating to the traffic generator. It must be called while the
   * simulation is still `created`: it only populates the runtime's requests
   * and event queue and does not advance the clock or change the status.
   *
   * @throws If the simulation is not currently `created`.
   */
  initializeTraffic(sourceNodeId: string): void {
    if (this.runtime.simulation.status !== "created") {
      throw new Error(
        `Traffic cannot be initialized from status ${this.runtime.simulation.status}`,
      );
    }

    this.trafficGenerator.generate(sourceNodeId);
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

  /** Continues processing eligible events while the simulation is running. */
  private execute(): void {
    while (this.runtime.simulation.status === "running") {
      // While the simulation is running, keep processing until there is no eligible event.
      const processed = this.processNextEvent();

      if (!processed) {
        break;
      }
    }
  }

  /** Marks the simulation completed and records when it finished. */
  private complete(): void {
    this.runtime.simulation.status = "completed";
    this.runtime.simulation.completedAt = new Date();
  }

  /** Marks the simulation failed and records when it stopped. */
  private fail(): void {
    this.runtime.simulation.status = "failed";
    this.runtime.simulation.completedAt = new Date();
  }
}
