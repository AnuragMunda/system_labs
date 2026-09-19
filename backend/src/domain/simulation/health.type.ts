/**
 * @file health.type.ts
 *
 * @description Threshold-based health criteria for architecture components.
 * Each metric carries a `degraded` and a `critical` bound; a component whose
 * metric reaches `degraded` is reported as degraded and one that reaches
 * `critical` is reported as critical.
 */
export interface ComponentHealthThresholds {
  /** Bounds on resource utilization (0-1, fraction of effective concurrency in use). */
  utilization: {
    degraded: number;
    critical: number;
  };

  /** Bounds on the proportion of processing attempts that failed (0-1). */
  errorRate: {
    degraded: number;
    critical: number;
  };

  /** Bounds on average processing latency in milliseconds. */
  latencyMs: {
    degraded: number;
    critical: number;
  };
}
