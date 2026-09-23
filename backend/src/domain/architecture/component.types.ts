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

/** Retry/circuit-breaker policy for a component. */
export interface RetryPolicy {
  retries: number;
  circuitBreaker: boolean;
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
