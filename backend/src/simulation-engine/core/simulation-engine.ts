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
    private readonly processEvent: EventProcessor,
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
    while (!this.runtime.eventQueue.isEmpty()) {
      const event = this.runtime.eventQueue.dequeue();

      if (!event) {
        break;
      }

      this.runtime.clock.advanceTo(event.timestampMs);

      this.processEvent(event);
    }
  }
}
