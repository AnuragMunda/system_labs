/**
 * @file simulations.ts
 *
 * @description Drizzle schemas for the "simulations", "simulation_events", and
 * "metrics" tables. Simulations track a run against an architecture, while
 * events and metrics capture what happened during the run.
 */

import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { architecturesTable } from "./architectures.js";
import { ArchitectureGraph, SimulationConfig } from "./types/types.js";

/** The lifecycle states a simulation can be in, stored in the database. */
export const simulationStatusEnum = pgEnum("simulation_status", [
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

/** Simulations table. A simulation belongs to an architecture and records config + status. */
export const simulationsTable = pgTable(
  "simulations",
  {
    id: uuid().primaryKey().defaultRandom(),
    architectureId: uuid("architecture_id")
      .notNull()
      .references(() => architecturesTable.id, { onDelete: "cascade" }),
    status: simulationStatusEnum("status").notNull().default("created"),

    // Seed used by the deterministic PRNG driving this run.
    seed: integer("seed"),
    // Simulation-time cursor (ms since start) reflecting engine progress.
    currentTimeMs: integer("current_time_ms").notNull().default(0),

    config: jsonb("config").$type<SimulationConfig>(),
    snapshot: jsonb("snapshot").$type<ArchitectureGraph>(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("simulations_architecture_id_idx").on(table.architectureId),
  ],
);

/** Events emitted during a simulation, stored for replay and visualization. */
export const simulationEventsTable = pgTable(
  "simulation_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    simulationId: uuid("simulation_id")
      .notNull()
      .references(() => simulationsTable.id, { onDelete: "cascade" }),
    timestampMs: integer("timestamp_ms").notNull(),
    eventType: varchar("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index("simulation_events_simulation_timestamp_idx").on(
      table.simulationId,
      table.timestampMs,
    ),
  ],
);

/** Performance metrics sampled during a simulation, indexed by time. */
export const metricsTable = pgTable(
  "metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    simulationId: uuid("simulation_id")
      .notNull()
      .references(() => simulationsTable.id, { onDelete: "cascade" }),
    timestampMs: integer("timestamp_ms").notNull(),

    // Set when the sample is scoped to a single node; null for global samples.
    nodeId: varchar("node_id"),

    requestsPerSec: real("requests_per_sec"),
    avgLatencyMs: real("avg_latency_ms"),
    errorRate: real("error_rate"),
    queueDepth: integer("queue_depth"),
    cacheHitRate: real("cache_hit_rate"),
    activeConnections: integer("active_connections"),
  },
  (table) => [
    index("metrics_simulation_timestamp_idx").on(
      table.simulationId,
      table.timestampMs,
    ),
  ],
);
