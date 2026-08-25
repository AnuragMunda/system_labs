/**
 * @file simulation-engine.ts
 *
 * @description The discrete-event simulation core. Pops events from the
 * event queue in timestamp order, advances the virtual clock to each event's
 * timestamp, and delegates processing to an injected event handler.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { EventQueue } from "./event-queue.js";
import { SimulationClock } from "./simulation-clock.js";
import { EventProcessor } from "../types.js";

/**
 * Coordinates the clock, event queue, and an injected processor to run a
 * deterministic discrete-event simulation. The engine knows nothing about
 * what events mean — that is entirely the processor's responsibility.
 */
export class SimulationEngine {
  constructor(
    private readonly clock: SimulationClock,
    private readonly eventQueue: EventQueue,
    private readonly processEvent: EventProcessor,
  ) {}

  /** Queues an event for future processing by the engine. */
  schedule(event: SimulationEvent): void {
    this.eventQueue.enqueue(event);
  }

  /**
   * Drains the event queue: advances the clock to each event's timestamp and
   * invokes the processor, returning once every scheduled event has run.
   */
  run(): void {
    while (!this.eventQueue.isEmpty()) {
      const event = this.eventQueue.dequeue();

      if (!event) {
        break;
      }

      this.clock.advanceTo(event.timestampMs);

      this.processEvent(event);
    }
  }

  /** Returns the current virtual simulation time in milliseconds. */
  getCurrentTime(): number {
    return this.clock.now();
  }

  /** Returns true while events remain queued but unprocessed. */
  hasPendingEvents(): boolean {
    return !this.eventQueue.isEmpty();
  }

  /** Rewinds the clock to zero and discards queued events for a fresh run. */
  reset(): void {
    this.clock.reset();
    this.eventQueue.clear();
  }
}
