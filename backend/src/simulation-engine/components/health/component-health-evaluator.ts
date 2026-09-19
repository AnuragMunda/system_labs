/**
 * @file component-health-evaluator.ts
 *
 * @description Computes a component's health from its observed runtime metrics
 * by comparing utilization, error rate, and average latency against configured
 * thresholds. Each metric maps to a severity (`0` healthy, `1` degraded, `2`
 * critical) and the overall health reflects the worst metric.
 */

import { ComponentHealthThresholds } from "@/domain/simulation/health.type.js";
import { ComponentRuntimeState } from "../component-runtime-state.js";
import { RuntimeComponentHealth } from "@/domain/architecture/component.types.js";

/** The observables a component's health is derived from. */
export interface ComponentHealthMetrics {
  /** Fraction of effective concurrency currently in use (0-1). */
  utilization: number;
  /** Proportion of processing attempts that failed (0-1). */
  errorRate: number;
  /** Average processing latency in milliseconds. */
  averageLatencyMs: number;
}

/**
 * Evaluates a component's health from its runtime counters. Severity per
 * metric: `0` (below `degraded`), `1` (at or above `degraded`), `2` (at or
 * above `critical`). The returned health is the worst severity across metrics.
 */
export class ComponentHealthEvaluator {
  /**
   * Maps a component's runtime state to a health level given thresholds.
   * Returns `"healthy"`, `"degraded"`, or `"critical"`.
   */
  evaluate(
    runtimeState: ComponentRuntimeState,
    thresholds: ComponentHealthThresholds,
  ): RuntimeComponentHealth {
    const metrics = this.calculateMetrics(runtimeState);

    const severity = Math.max(
      this.getUtilizationSeverity(metrics.utilization, thresholds.utilization),
      this.getErrorRateSeverity(metrics.errorRate, thresholds.errorRate),
      this.getLatencySeverity(metrics.averageLatencyMs, thresholds.latencyMs),
    );

    switch (severity) {
      case 2:
        return "critical";

      case 1:
        return "degraded";

      default:
        return "healthy";
    }
  }

  /**
   * Derives the health-relevant metrics from a component's runtime counters.
   * Guarded against zero divisors: no concurrency reports full utilization,
   * no attempts reports a zero error rate, and no completed requests report
   * zero average latency.
   */
  calculateMetrics(
    runtimeState: ComponentRuntimeState,
  ): ComponentHealthMetrics {
    const concurrency = runtimeState.effectiveConcurrency;

    const utilization =
      concurrency <= 0 ? 1 : runtimeState.activeRequests / concurrency;

    const errorRate =
      runtimeState.totalProcessingAttempts === 0
        ? 0
        : runtimeState.failedProcessingAttempts /
          runtimeState.totalProcessingAttempts;

    const averageLatencyMs =
      runtimeState.processedRequests === 0
        ? 0
        : runtimeState.totalProcessingLatencyMs /
          runtimeState.processedRequests;

    return {
      utilization,
      errorRate,
      averageLatencyMs,
    };
  }

  /** Severity of a utilization value against its thresholds. */
  private getUtilizationSeverity(
    value: number,
    thresholds: ComponentHealthThresholds["utilization"],
  ): number {
    if (value >= thresholds.critical) {
      return 2;
    }

    if (value >= thresholds.degraded) {
      return 1;
    }

    return 0;
  }

  /** Severity of an error rate against its thresholds. */
  private getErrorRateSeverity(
    value: number,
    thresholds: ComponentHealthThresholds["errorRate"],
  ): number {
    if (value >= thresholds.critical) {
      return 2;
    }

    if (value >= thresholds.degraded) {
      return 1;
    }

    return 0;
  }

  /** Severity of an average latency against its thresholds. */
  private getLatencySeverity(
    value: number,
    thresholds: ComponentHealthThresholds["latencyMs"],
  ): number {
    if (value >= thresholds.critical) {
      return 2;
    }

    if (value >= thresholds.degraded) {
      return 1;
    }

    return 0;
  }
}
