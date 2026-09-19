/**
 * @file default-thresholds.ts
 *
 * @description Default health thresholds applied to a component when it does
 * not declare its own `healthThresholds` in its configuration.
 */

import { ComponentHealthThresholds } from "@/domain/simulation/health.type.js";

export const DEFAULT_HEALTH_THRESHOLDS: ComponentHealthThresholds = {
  utilization: {
    degraded: 0.7,
    critical: 0.9,
  },

  errorRate: {
    degraded: 0.05,
    critical: 0.2,
  },

  latencyMs: {
    degraded: 200,
    critical: 500,
  },
};
