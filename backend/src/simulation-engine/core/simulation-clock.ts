/**
 * @file simulation-clock.ts
 *
 * @description A monotonic virtual clock that drives the simulation engine's
 * discrete-event loop. Instead of relying on wall-clock time, the engine moves
 * this clock forward to the timestamp of the next scheduled event, allowing a
 * multi-hour simulation to execute in milliseconds of real time.
 */

/**
 * Virtual clock tracking the current simulation time in milliseconds since the
 * simulation started.
 *
 * Time is strictly monotonic: it only ever moves forward. This guarantees the
 * event queue can rely on causal ordering — an event can never be processed
 * "before" something that already happened at the same clock reading or later.
 */
export class SimulationClock {
  /** Current simulation time, in milliseconds since simulation start. */
  private currentTimeMs: number = 0;

  /**
   * Returns the current simulation time in milliseconds.
   */
  now(): number {
    return this.currentTimeMs;
  }

  /**
   * Advances the clock forward to the given timestamp.
   *
   * @param timestamp - Absolute simulation time (ms since start) to jump to,
   * typically the timestamp of the next event in the event queue.
   * @throws If the timestamp is negative or earlier than the current time,
   * since moving backwards would break event ordering guarantees.
   */
  advanceTo(timestamp: number): void {
    if (timestamp < 0) throw new Error("Simulation time cannot be negative.");

    if (timestamp < this.currentTimeMs)
      throw new Error("Timestamp must be greater than current time.");

    this.currentTimeMs = timestamp;
  }

  /**
   * Rewinds the clock to zero so the instance can be reused for a fresh run.
   */
  reset(): void {
    this.currentTimeMs = 0;
  }
}
