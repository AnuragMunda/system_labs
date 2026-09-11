/**
 * @file traffic-generator.ts
 *
 * @description Generates the initial load for a simulation by creating
 * `request.created` events at a fixed rate for a configurable duration. Each
 * generated event is paired with a matching pending request stored in the
 * runtime, ready for the simulation engine to process.
 */

import { SimulationRequest } from "@/domain/simulation/request.types.js";
import { SimulationEngine } from "./simulation-engine.js";
import { SimulationRuntime } from "./simulation-runtime.js";

/**
 * Produces the starting traffic of a simulation. It reads the rate and
 * duration from the simulation config, then schedules one `request.created`
 * event per time slice, keeping the engine and runtime in lockstep without
 * owning any simulation state itself.
 */
export class TrafficGenerator {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly engine: SimulationEngine,
  ) {}

  /**
   * Generates load from the given source node for the simulation's configured
   * rate and duration.
   *
   * Requests are emitted at a constant `1000 / requestsPerSecond` millisecond
   * interval, starting at 0ms. The interval endpoint is exclusive: when an
   * arrival would land exactly on `durationMs` it is not emitted. Fractional
   * timestamps are rounded to the nearest whole millisecond for event and
   * request timestamps.
   *
   * @param sourceNodeId - The component each generated request originates from.
   */
  generate(sourceNodeId: string): void {
    const { requestsPerSecond, durationMs } = this.runtime.simulation.config;

    if (requestsPerSecond <= 0 || durationMs <= 0) {
      return; // No traffic to generate
    }

    const intervalMs = 1000 / requestsPerSecond;

    let timestampMs = 0;
    let sequence = 0;

    while (timestampMs < durationMs) {
      const requestId = this.createRequestId(sequence);
      const eventTimestampMs = Math.round(timestampMs);

      const request: SimulationRequest = {
        id: requestId,
        status: "pending",
        createdAtMs: eventTimestampMs,
        attempts: 0,
      };

      this.runtime.createRequest(request);

      this.engine.schedule({
        id: this.createEventId(sequence),
        simulationId: this.runtime.simulation.id,
        timestampMs: eventTimestampMs,
        type: "request.created",
        sourceNodeId,
        payload: { requestId },
      });

      timestampMs += intervalMs;
      sequence++;
    }
  }

  /** Builds the deterministic request id for the given arrival slot. */
  private createRequestId(sequence: number): string {
    return `${this.runtime.simulation.id}:request:${sequence}`;
  }

  /** Builds the deterministic event id for the given arrival slot. */
  private createEventId(sequence: number): string {
    return `${this.runtime.simulation.id}:event:request-created:${sequence}`;
  }
}
