/**
 * @file simulation.repository.ts
 *
 * @description Persistence layer for simulations. Owns all direct database
 * access (via Drizzle) and translates known DB errors into API errors. Only
 * metadata and the derived aggregate report are persisted here; live engine
 * runtime state never reaches the database.
 */

import { eq } from "drizzle-orm";

import db from "@/infrastructure/database/db.js";
import { simulationsTable } from "@/infrastructure/database/schema/simulations.js";
import { InternalServerError, NotFoundError } from "@/lib/apiError.js";
import { mapDbError } from "@/lib/index.js";

import {
  CreateSimulationRecord,
  UpdateSimulationRecord,
} from "./simulation.dto.js";

/** A row as stored in the simulations table. */
export type SimulationRow = typeof simulationsTable.$inferSelect;

/** Data access for the simulations table. */
export class SimulationRepository {
  /** Inserts a new simulation row and returns it. */
  async create(data: CreateSimulationRecord): Promise<SimulationRow> {
    try {
      const [simulation] = await db
        .insert(simulationsTable)
        .values({ ...data, currentTimeMs: Math.round(data.currentTimeMs) })
        .returning();

      if (!simulation) {
        throw InternalServerError("Failed to create simulation.");
      }

      return simulation;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  /** Finds a simulation by id, throwing NotFoundError if missing. */
  async findById(id: string): Promise<SimulationRow> {
    const [simulation] = await db
      .select()
      .from(simulationsTable)
      .where(eq(simulationsTable.id, id));

    if (!simulation) {
      throw NotFoundError();
    }

    return simulation;
  }

  /**
   * Updates lifecycle metadata and/or the persisted report for a simulation,
   * throwing NotFoundError when no row matches.
   */
  async updateLifecycle(
    id: string,
    data: UpdateSimulationRecord,
  ): Promise<SimulationRow> {
    try {
      const values: UpdateSimulationRecord = {
        ...data,
        ...(data.currentTimeMs !== undefined
          ? { currentTimeMs: Math.round(data.currentTimeMs) }
          : {}),
      };

      const [simulation] = await db
        .update(simulationsTable)
        .set(values)
        .where(eq(simulationsTable.id, id))
        .returning();

      if (!simulation) {
        throw NotFoundError();
      }

      return simulation;
    } catch (error) {
      throw mapDbError(error);
    }
  }
}
