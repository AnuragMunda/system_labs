/**
 * @file simulation.dto.ts
 *
 * @description Data-transfer types for the simulation module. `Dto` types are
 * inferred from the Zod request schemas, `Record` types describe the column
 * shapes persisted by the repository, and the response views are the plain
 * shapes returned to callers.
 */

import { z } from "zod";

import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type { SimulationMetrics } from "@/domain/simulation/metrics.types.js";
import type {
  SimulationConfig,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";

import {
  createSimulationSchema,
  listSimulationsQuerySchema,
} from "./simulation.schema.js";

/** Payload accepted when creating a simulation. */
export type CreateSimulationDto = z.infer<typeof createSimulationSchema>;

/** Query params accepted when listing simulations. */
export type ListSimulationsQueryDto = z.infer<
  typeof listSimulationsQuerySchema
>;

/** Standard paginated result envelope returned by list operations. */
export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Row shape persisted when creating a simulation. */
export interface CreateSimulationRecord {
  architectureId: string;
  status: SimulationStatus;
  seed: number | null;
  currentTimeMs: number;
  sourceNodeId: string;
  config: SimulationConfig;
  snapshot: ArchitectureGraph;
}

/**
 * Partial row shape accepted when advancing a simulation's lifecycle. Only the
 * metadata/aggregate-report columns are writable; the captured snapshot and
 * config are immutable for a run.
 */
export interface UpdateSimulationRecord {
  status?: SimulationStatus;
  currentTimeMs?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  result?: SimulationMetrics | null;
  error?: string | null;
}

/** A simulation's full metadata and lifecycle state, excluding its report. */
export interface SimulationDetails {
  id: string;
  architectureId: string;
  status: SimulationStatus;
  seed: number | null;
  currentTimeMs: number;
  sourceNodeId: string | null;
  config: SimulationConfig | null;
  snapshot: ArchitectureGraph | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  createdAt: Date;
}

/** A lightweight view of a simulation's progress. */
export interface SimulationStatusView {
  id: string;
  status: SimulationStatus;
  /** Simulation-time cursor (ms since start) reflecting engine progress. */
  currentTimeMs: number;
  /** Configured total duration in ms, used to derive progress; null if unknown. */
  durationMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

/**
 * A list-friendly summary of a run. Extends the status view with the identifying
 * metadata a dashboard needs, deliberately omitting the (potentially large)
 * snapshot, config, and aggregate report.
 */
export interface SimulationSummary extends SimulationStatusView {
  architectureId: string;
  seed: number | null;
  createdAt: Date;
}

/** A simulation's details together with its persisted aggregate report. */
export interface SimulationResultView {
  simulation: SimulationDetails;
  metrics: SimulationMetrics;
}
