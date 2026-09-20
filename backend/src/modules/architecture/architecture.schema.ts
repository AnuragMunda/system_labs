/**
 * @file architecture.schema.ts
 *
 * @description Zod schemas for the architecture module. Used by controllers to
 * validate request bodies, path params, and query strings before they reach
 * the service layer.
 */

import { z } from "zod";

/** The supported kinds of architecture components. */
const componentTypeSchema = z.enum([
  "client",
  "load_balancer",
  "api_gateway",
  "cdn",
  "reverse_proxy",
  "api",
  "cache",
  "database",
  "queue",
  "worker",
  "server",
  "serverless_function",
  "postgresql",
  "mysql",
  "mongodb",
  "redis",
  "object_storage",
  "kafka",
  "rabbitmq",
  "event_bus",
  "external_api",
  "payment_provider",
  "auth_provider",
]);

/** X/Y canvas coordinates for a node. */
const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * Optional autoscaling bounds for a component. Min/max are positive integers
 * with max >= min; the target utilization is a percentage in 0..100.
 */
const autoscalingSchema = z
  .object({
    enabled: z.boolean(),
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    targetCpu: z.number().min(0).max(100),
  })
  .refine((config) => config.max >= config.min, {
    message: "Autoscaling max must be greater than or equal to min",
  })
  .optional();

/** Optional retry/circuit-breaker policy for a component. */
const retryPolicySchema = z
  .object({
    retries: z.number().int().nonnegative(),
    circuitBreaker: z.boolean(),
  })
  .optional();

/** Optional runtime tuning for a component node. */
const componentConfig = z.object({
  latencyMs: z.number().nonnegative().optional(),
  capacity: z.number().positive().optional(),
  concurrency: z.number().nonnegative().optional(),
  errorRate: z.number().min(0).max(1).optional(),

  // Extended editor configuration
  replicas: z.number().int().nonnegative().optional(),
  cpu: z.number().nonnegative().optional(),
  memory: z.number().nonnegative().optional(),
  autoscaling: autoscalingSchema,
  region: z.string().optional(),
  timeoutMs: z.number().nonnegative().optional(),
  retryPolicy: retryPolicySchema,
  traffic: z.number().nonnegative().optional(),
  health: z.enum(["healthy", "degraded", "critical"]).optional(),
});

/** Optional runtime tuning for a connection edge. */
const connectionConfig = z.object({
  latencyMs: z.number().nonnegative().optional(),
  bandwidthMbps: z.number().positive().optional(),
  packetLossRate: z.number().min(0).max(1).optional(),

  // Extended editor configuration
  protocol: z.string().optional(),
  trafficRate: z.number().nonnegative().optional(),
});

/** A single node in the architecture graph. */
const nodeSchema = z.object({
  id: z.string(),
  type: componentTypeSchema,
  name: z.string().min(1),
  position: positionSchema,
  config: componentConfig,
});

/** A single directed edge in the architecture graph. */
const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  config: connectionConfig,
});

/** Validates the body for creating a new architecture. */
export const architectureSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

/** Validates the `:id` path param as a UUID. */
export const idParamSchema = z.object({
  id: z.uuid(),
});

/** Validates query params for listing architectures (optional project filter + pagination). */
export const listArchitecturesQuerySchema = z.object({
  projectId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Validates the body for updating an architecture. All fields optional; projectId is not updatable. */
export const updateArchitectureSchema = architectureSchema
  .omit({ projectId: true })
  .partial();
