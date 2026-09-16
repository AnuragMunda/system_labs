/**
 * @file failure-scheduler.ts
 */

import { FailureSchedule } from "@/domain/simulation/simulation.types.js";
import type { SimulationRuntime } from "./simulation-runtime.js";

/**
 * Converts the failure schedule in a simulation's config into `component.failed`
 * and `component.recovered` events queued on the runtime, so components fail and
 * recover while the simulation runs.
 */
export class FailureScheduler {
  constructor(private readonly runtime: SimulationRuntime) {}

  /**
   * Validates each configured failure and queues its failure (and optional
   * recovery) event at the configured timestamps.
   */
  schedule(): void {
    const failures = this.runtime.simulation.config.failures ?? [];

    for (const failure of failures) {
      this.validate(failure);

      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: this.runtime.simulation.id,
        timestampMs: failure.failedAtMs,
        type: "component.failed",
        sourceNodeId: failure.nodeId,
      });

      if (failure.recoverAtMs !== undefined) {
        this.runtime.schedule({
          id: crypto.randomUUID(),
          simulationId: this.runtime.simulation.id,
          timestampMs: failure.recoverAtMs,
          type: "component.recovered",
          sourceNodeId: failure.nodeId,
        });
      }
    }
  }

  /**
   * Ensures a failure entry is well-formed: its nodes exist in the topology and
   * its failure/recovery times fall strictly within the simulation duration,
   * with recovery always after failure.
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

    if (
      failure.recoverAtMs !== undefined &&
      failure.recoverAtMs <= failure.failedAtMs
    ) {
      throw new Error(
        `Recovery time ${failure.recoverAtMs} must be greater than failure time ${failure.failedAtMs}.`,
      );
    }

    if (
      failure.recoverAtMs !== undefined &&
      failure.recoverAtMs >= durationMs
    ) {
      throw new Error(
        `Recovery time ${failure.recoverAtMs} must be less than simulation duration ${durationMs}.`,
      );
    }
  }
}
