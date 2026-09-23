/**
 * @file traffic-generator.ts
 *
 * @description Generates the initial load for a simulation by creating
 * `request.created` events at a fixed rate for a configurable duration. Each
 * generated event is paired with a matching pending request stored in the
 * runtime, ready for the simulation engine to process.
 */

import { SimulationRequest } from "@/domain/simulation/request.types.js";
import { SimulationRuntime } from "../core/simulation-runtime.js";
import { createEvent } from "../utils/helpers.js";
import { MILLISECONDS_PER_SECOND } from "../utils/constants.js";

/**
 * Produces the starting traffic of a simulation. It reads the rate and
 * duration from the simulation config, then schedules one `request.created`
 * event per time slice, keeping the engine and runtime in lockstep without
 * owning any simulation state itself.
 */
export class TrafficGenerator {
  constructor(private readonly runtime: SimulationRuntime) {}

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

    const intervalMs = MILLISECONDS_PER_SECOND / requestsPerSecond;

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
        cacheKey: this.createCacheKey(sequence),
      };

      this.runtime.createRequest(request);

      this.runtime.schedule(
        createEvent({
          id: this.createEventId(sequence),
          simulationId: this.runtime.simulation.id,
          timestampMs: eventTimestampMs,
          type: "request.created",
          sourceNodeId,
          payload: { requestId },
        }),
      );

      timestampMs += intervalMs;
      sequence++;
    }
  }

  /** Builds the deterministic request id for the given arrival slot. */
  private createRequestId(sequence: number): string {
    return `${this.runtime.simulation.id}:request:${sequence}`;
  }

  /**
   * Builds the deterministic cache resource key for the given arrival slot.
   *
   * Configured keys are cycled round-robin so multiple requests share a key
   * and a cache can produce hits. Without a configured pool every arrival
   * receives a unique synthetic key, which never produces a hit.
   */
  private createCacheKey(sequence: number): string {
    const cacheKeys = this.runtime.simulation.config.cacheKeys;

    if (cacheKeys && cacheKeys.length > 0) {
      return cacheKeys[sequence % cacheKeys.length]!;
    }

    return `GET:/resource/${sequence}`;
  }

  /** Builds the deterministic event id for the given arrival slot. */
  private createEventId(sequence: number): string {
    return `${this.runtime.simulation.id}:event:request-created:${sequence}`;
  }
}
