/**
 * @file failure-scheduler.ts
 */

import { FailureSchedule } from "@/domain/simulation/simulation.types.js";
import type { SimulationRuntime } from "../core/simulation-runtime.js";
import { createEvent } from "../utils/helpers.js";

/**
 * Converts the failure schedule in a simulation's config into
 * `component.failed` events queued on the runtime, so components fail while the
 * simulation runs. Recovery is handled separately by the event processor based
 * on the failed component's `recoveryDelayMs` configuration.
 */
export class FailureScheduler {
  constructor(private readonly runtime: SimulationRuntime) {}

  /**
   * Validates each configured failure and queues its failure event.
   *
   * Recovery is handled automatically by the event processor based on the
   * failed component's recoveryDelayMs configuration.
   */
  schedule(): void {
    const failures = this.runtime.simulation.config.failures ?? [];

    for (const failure of failures) {
      this.validate(failure);

      this.runtime.schedule(
        createEvent({
          simulationId: this.runtime.simulation.id,
          timestampMs: failure.failedAtMs,
          type: "component.failed",
          sourceNodeId: failure.nodeId,
        }),
      );
    }
  }

  /**
   * Ensures a failure entry is well-formed.
   */
  private validate(failure: FailureSchedule): void {
    const node = this.runtime.topology.getNode(failure.nodeId);

    if (!node) {
      throw new Error(`Node not found: ${failure.nodeId}`);
    }

    const { durationMs } = this.runtime.simulation.config;

    if (failure.failedAtMs < 0) {
      throw new Error(`Failure time cannot be negative: ${failure.failedAtMs}`);
    }

    if (failure.failedAtMs >= durationMs) {
      throw new Error(
        `Failure time ${failure.failedAtMs} must be less than simulation duration ${durationMs}.`,
      );
    }
  }
}
