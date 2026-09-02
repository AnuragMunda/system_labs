/**
 * @file component.types.ts
 *
 * @description This file defines the types and interfaces related to architecture components in the system.
 */

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
interface ComponentConfig {
  latencyMs?: number; // Average latency in milliseconds
  capacity?: number; // Maximum number of requests that can be processed simultaneously
  concurrency?: number; // Number of concurrent operations
  errorRate?: number; // Rate of errors occurring (0-1)

  // Extended editor configuration
  replicas?: number;
  cpu?: number; // CPU cores per replica
  memory?: number; // Memory in GB per replica
  autoscaling?: AutoscalingConfig;
  region?: string;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  traffic?: number; // Requests per second handled
  health?: RuntimeComponentHealth;
}

export type RuntimeComponentHealth =
  "healthy" | "degraded" | "critical" | "failed";
