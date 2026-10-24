/**
 * @file simulation.schema.ts
 *
 * @description Zod schemas for the simulation module. Used by the validate
 * middleware to check create bodies and by controllers to validate path params
 * before they reach the service layer. `SimulationConfig` had no boundary
 * before this module; this is where it is defined.
 */

import { z } from "zod";

/** Validates the `:id` path param as a UUID. */
export const idParamSchema = z.object({
  id: z.uuid(),
});

/**
 * Validates the configuration that drives a simulation run.
 *
 * Required fields are the load shape (`durationMs`, `requestsPerSecond`); the
 * remaining fields are optional with defaults matching the engine's behavior.
 * A scheduled failure must land strictly before the run's duration, otherwise
 * the engine's failure scheduler would reject it mid-run — catching it here
 * produces a 400 instead of a server error.
 */
export const simulationConfigSchema = z
  .object({
    durationMs: z.number().int().positive(),
    requestsPerSecond: z.number().nonnegative(),
    simulationSpeed: z.number().positive().default(1),
    randomSeed: z.number().int().optional(),
    collectMetrics: z.boolean().default(true),
    emitEvents: z.boolean().default(true),
    cacheKeys: z.array(z.string()).optional(),
    databaseOperations: z.array(z.enum(["read", "write"])).optional(),
    failures: z
      .array(
        z.object({
          nodeId: z.string().min(1),
          failedAtMs: z.number().int().nonnegative(),
        }),
      )
      .optional(),
  })
  .superRefine((config, ctx) => {
    for (const failure of config.failures ?? []) {
      if (failure.failedAtMs >= config.durationMs) {
        ctx.addIssue({
          code: "custom",
          message: `Failure time ${failure.failedAtMs} must be less than simulation duration ${config.durationMs}`,
          path: ["failures"],
        });
      }
    }
  });

/**
 * Validates the body for creating a simulation.
 *
 * The traffic source node is supplied by the caller (it describes topology, not
 * load shape); the service verifies it exists in the captured snapshot.
 */
export const createSimulationSchema = z.object({
  architectureId: z.uuid(),
  sourceNodeId: z.string().min(1),
  config: simulationConfigSchema,
});

/**
 * Validates query params for listing simulations (pagination + optional
 * architecture/project filters). Mirrors the list schemas used by the project
 * and architecture modules.
 */
export const listSimulationsQuerySchema = z.object({
  architectureId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  // Saved runs are the default view. Pass `saved=false` to list unsaved drafts
  // (used by the editor to reattach to an in-flight run).
  saved: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
