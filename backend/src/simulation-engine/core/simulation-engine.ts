/**
 * @file simulation-engine.ts
 *
 * @description The simulation orchestrator. It drives a `SimulationRuntime`'s
 * event queue and clock to execute a simulation, but owns no state of its own
 * and knows nothing about what events mean — event semantics are the injected
 * processor's responsibility, and setup (traffic generation, failure
 * scheduling, autoscaling initialization) is a separate concern composed by a
 * `SimulationSession`.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { EventProcessor } from "../utils/types.js";
import { SimulationRuntime } from "./simulation-runtime.js";
import { transitionSimulationStatus } from "./simulation-lifecycle.js";

/**
 * Orchestrates how a simulation executes: it reads the runtime's state (its
 * event queue and clock) to run each event, answering "how do I execute the
 * simulation?" while leaving "what state does it currently have?" to the
 * runtime. The engine stays agnostic of event semantics and scenario setup.
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
    transitionSimulationStatus(this.runtime.simulation, "start");
  }

  /**
   * Processes the next eligible event in the queue — advancing the clock to
   * its timestamp and invoking the processor — leaving the simulation
   * otherwise in place. Returns `true` when an event was processed and
   * `false` when nothing eligible remains in the queue.
   *
   * @throws If the simulation is not currently `running`. If processing the
   *   event throws, the simulation transitions to `failed` before the error
   *   propagates.
   */
  step(): boolean {
    transitionSimulationStatus(this.runtime.simulation, "step");

    if (!this.hasPendingEvents()) {
      this.complete();
      return false;
    }

    try {
      this.processNextEvent();
    } catch (error) {
      this.fail();

      throw error;
    }

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
    transitionSimulationStatus(this.runtime.simulation, "pause");
  }

  /** Resumes a paused simulation so event processing can continue. */
  resume(): void {
    transitionSimulationStatus(this.runtime.simulation, "resume");
  }

  /**
   * Cancels a created, running, or paused simulation, marking it cancelled and
   * recording when it ended.
   */
  cancel(): void {
    transitionSimulationStatus(this.runtime.simulation, "cancel");
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
    transitionSimulationStatus(this.runtime.simulation, "complete");
  }

  /** Marks the simulation failed and records when it stopped. */
  private fail(): void {
    transitionSimulationStatus(this.runtime.simulation, "fail");
  }
}
