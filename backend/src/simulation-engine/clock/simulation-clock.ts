export class SimulationClock {
  private currentTimeMs: number = 0;

  now(): number {
    return this.currentTimeMs;
  }

  advanceTo(timestamp: number): void {
    if (timestamp < 0) throw new Error("Simulation time cannot be negative.");

    if (timestamp < this.currentTimeMs)
      throw new Error("Timestamp must be greater than current time.");

    this.currentTimeMs = timestamp;
  }

  reset(): void {
    this.currentTimeMs = 0;
  }
}
