/**
 * @file constants.ts
 *
 * @description Shared numeric/data constants for the simulation engine. Keeping
 * engine-wide defaults in a single file makes them easy to audit and change.
 */

import { ComponentHealthThresholds } from "@/domain/simulation/health.type.js";

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Milliseconds per second, used to convert per-second rates to intervals. */
export const MILLISECONDS_PER_SECOND = 1000;

/** Default delay between a failed attempt and its retry. */
export const DEFAULT_RETRY_DELAY_MS = 10;

/** Applied when a connection has no latency configured. */
export const DEFAULT_NETWORK_LATENCY_MS = 10;

/** Applied when a request does not declare a payload size. */
export const DEFAULT_REQUEST_SIZE_BYTES = 1024;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Default replica count when a node config omits `replicas`. */
export const DEFAULT_REPLICAS = 1;

/** Default per-replica concurrency when a node config omits `concurrency`. */
export const DEFAULT_CONCURRENCY = 1;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Default health thresholds applied to a component when it does not declare its
 * own `healthThresholds` in its configuration.
 */
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

// ---------------------------------------------------------------------------
// Autoscaling
// ---------------------------------------------------------------------------

/** Default interval between autoscaling evaluations. */
export const DEFAULT_AUTOSCALING_EVALUATION_INTERVAL_MS = 1000;

/** Width of the deadband around the autoscaling target, as a percentage. */
export const AUTOSCALING_DEADBAND_PERCENT = 10;
