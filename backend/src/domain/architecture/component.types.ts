/**
 * @file component.types.ts
 *
 * @description This file defines the types and interfaces related to architecture components in the system.
 */

import { ComponentHealthThresholds } from "../simulation/health.type.js";

/**
 * A node in an architecture graph. Each node represents one deployable
 * component (e.g. an API gateway, cache, database) and its configuration.
 */
export interface ArchitectureNode {
  id: string;
  type: componentType;
  name: string;
  position: {
    x: number;
    y: number;
  };
  config: ComponentConfig;
}

/** The supported kinds of architecture components. */
export type componentType =
  | "client"
  | "load_balancer"
  | "api_gateway"
  | "cdn"
  | "reverse_proxy"
  | "api"
  | "cache"
  | "database"
  | "queue"
  | "worker"
  | "server"
  | "serverless_function"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "redis"
  | "object_storage"
  | "kafka"
  | "rabbitmq"
  | "event_bus"
  | "external_api"
  | "payment_provider"
  | "auth_provider";

/** Supported load-balancing strategies for routing requests across a node's outgoing edges. */
export type RoutingStrategyType =
  "round_robin" | "random" | "least_connections";

/** Autoscaling bounds for a component. */
export interface AutoscalingConfig {
  enabled: boolean;
  min: number;
  max: number;
  targetCpu: number; // percentage 0-100
}

/**
 * The classification of why a request failed. Retry logic decides how to
 * treat a failure from this classification instead of parsing arbitrary reason
 * strings.
 */
export type FailureKind =
  | "component_failure"
  | "network_packet_loss"
  | "processing_error"
  | "queue_overflow"
  | "no_available_destination"
  | "circuit_open";

/** Retry/circuit-breaker policy for a component. */
export interface RetryPolicy {
  retries: number;
  /**
   * Circuit-breaker behavior. Accepts the structured configuration or a
   * legacy boolean for backward compatibility. A legacy boolean is ignored —
   * the breaker stays disabled unless an object explicitly enables it — so
   * existing architectures keep their current behavior.
   */
  circuitBreaker?: CircuitBreakerConfig | boolean;
}

/**
 * Circuit-breaker configuration for a component. The breaker only activates
 * when `enabled` is true; a legacy boolean or an object without enabled:true
 * leaves the circuit permanently closed.
 */
export interface CircuitBreakerConfig {
  /** Enables the circuit breaker for the component. Defaults to false. */
  enabled?: boolean;

  /** Consecutive retryable failures that trip the circuit open. Defaults to 5. */
  failureThreshold?: number;

  /** Simulated time the circuit stays open before a half-open probe is scheduled. Defaults to 5000ms. */
  openDurationMs?: number;
}

/** Runtime tuning knobs for a component, used during simulation. All fields are optional. */
export interface ComponentConfig {
  latencyMs?: number; // Average latency in milliseconds
  capacity?: number; // Maximum number of requests that can be processed simultaneously
  concurrency?: number; // Number of concurrent operations
  errorRate?: number; // Rate of errors occurring (0-1)
  replicas?: number;
  cpu?: number; // CPU cores per replica
  memory?: number; // Memory in GB per replica
  autoscaling?: AutoscalingConfig;

  /** Queue and backpressure behavior when the component is at full capacity.
   * Defaults to no queueing when omitted.
   */
  queue?: ComponentQueueConfig;

  region?: string;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  traffic?: number; // Requests per second handled
  health?: RuntimeComponentHealth;

  /** Which load-balancing algorithm to use when this node forwards requests downstream.
   * Defaults to round-robin if omitted.
   */
  routingStrategy?: RoutingStrategyType;

  /** Health thresholds used for automatic health evaluation.
   * Falls back to DEFAULT_HEALTH_THRESHOLDS when omitted.
   */
  healthThresholds?: ComponentHealthThresholds;

  /**
   * Amount of simulation time a failed component remains unavailable
   * before it automatically recovers.
   *
   * If omitted, the component does not automatically recover.
   */
  recoveryDelayMs?: number;
  cache?: CacheConfig;
}

export type RuntimeComponentHealth =
  "healthy" | "degraded" | "critical" | "failed";

/** How the queue behaves once it has reached `maxSize`. */
export type QueueOverflowStrategy = "reject" | "drop_oldest";

/** Queue and backpressure configuration for a component. */
export interface ComponentQueueConfig {
  /** Whether requests may be queued at all. */
  enabled?: boolean;
  /** Maximum number of requests that can wait in the queue. Omitted means the
   * queue is unbounded. */
  maxSize?: number;
  /** Strategy applied when the queue is full. Defaults to `"reject"`. */
  overflowStrategy?: QueueOverflowStrategy;
}

export interface CacheConfig {
  ttlMs: number;
  capacity: number;
  hitLatencyMs?: number;
  missLatencyMs?: number;
}
