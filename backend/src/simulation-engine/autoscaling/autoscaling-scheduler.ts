import { SimulationRuntime } from "../core/simulation-runtime.js";

export const DEFAULT_AUTOSCALING_EVALUATION_INTERVAL_MS = 1000;

export class AutoscalingScheduler {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly evaluationIntervalMs: number = DEFAULT_AUTOSCALING_EVALUATION_INTERVAL_MS,
  ) {}

  /**
   * Schedules the first autoscaling evaluation for every component that has
   * autoscaling enabled.
   *
   * Subsequent evaluations are scheduled by the event processor.
   */
  schedule(): void {
    if (this.evaluationIntervalMs <= 0) {
      throw new Error(
        `Autoscaling evaluation interval must be positive: ${this.evaluationIntervalMs}`,
      );
    }

    const durationMs = this.runtime.simulation.config.durationMs;

    if (durationMs <= this.evaluationIntervalMs) {
      return;
    }

    for (const node of this.runtime.simulation.architectureSnapshot.nodes) {
      if (!node.config.autoscaling?.enabled) {
        continue;
      }

      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: this.runtime.simulation.id,
        timestampMs: this.evaluationIntervalMs,
        type: "autoscaling.evaluate",
        sourceNodeId: node.id,
      });
    }
  }

  /**
   * Schedules the next evaluation for a component.
   *
   * Evaluations at or beyond the simulation duration are not scheduled.
   */
  scheduleNext(nodeId: string, timestampMs: number): void {
    const nextTimestampMs = timestampMs + this.evaluationIntervalMs;

    if (nextTimestampMs >= this.runtime.simulation.config.durationMs) {
      return;
    }

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: this.runtime.simulation.id,
      timestampMs: nextTimestampMs,
      type: "autoscaling.evaluate",
      sourceNodeId: nodeId,
    });
  }
}
