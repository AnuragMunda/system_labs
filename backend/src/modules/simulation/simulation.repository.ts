/**
 * @file simulation.repository.ts
 *
 * @description Persistence layer for simulations. Owns all direct database
 * access (via Drizzle) and translates known DB errors into API errors. Only
 * metadata and the derived aggregate report are persisted here; live engine
 * runtime state never reaches the database.
 *
 * Lifecycle writes are status-scoped: a transition only affects a row whose
 * persisted status is one the caller allows, so conflicting operations (e.g.
 * two concurrent starts, or a cancel racing a completion) can never both win.
 */

import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
} from "drizzle-orm";

import db from "@/infrastructure/database/db.js";
import { architecturesTable } from "@/infrastructure/database/schema/architectures.js";
import { projectsTable } from "@/infrastructure/database/schema/projects.js";
import { simulationsTable } from "@/infrastructure/database/schema/simulations.js";
import type { SimulationStatus } from "@/domain/simulation/simulation.types.js";
import { InternalServerError, NotFoundError } from "@/lib/apiError.js";
import { mapDbError } from "@/lib/index.js";

import {
  CreateSimulationRecord,
  UpdateSimulationRecord,
} from "./simulation.dto.js";

/** A row as stored in the simulations table. */
export type SimulationRow = typeof simulationsTable.$inferSelect;

/**
 * Normalizes a writable record: the persisted progress cursor is stored as an
 * integer column while the engine clock is fractional, so it is rounded here at
 * the persistence boundary. The input type is preserved so insert/update value
 * shapes keep their required/optional fields.
 */
function withRoundedTime<T extends { currentTimeMs?: number }>(data: T): T {
  if (data.currentTimeMs === undefined) {
    return data;
  }

  return { ...data, currentTimeMs: Math.round(data.currentTimeMs) };
}

/** Data access for the simulations table. */
export class SimulationRepository {
  /** Inserts a new simulation row and returns it. */
  async create(data: CreateSimulationRecord): Promise<SimulationRow> {
    try {
      const [simulation] = await db
        .insert(simulationsTable)
        .values(withRoundedTime(data))
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
   * Returns a page of simulations, newest first, restricted to architectures in
   * projects owned by `ownerId`. Optional `architectureId`/`projectId` filters
   * narrow within that scope. Reads are not wrapped because they don't mutate
   * data.
   */
  async findPaginated(filters: {
    ownerId: string;
    architectureId?: string;
    projectId?: string;
    saved: boolean;
    page: number;
    limit: number;
  }): Promise<SimulationRow[]> {
    const offset = (filters.page - 1) * filters.limit;

    return db
      .select()
      .from(simulationsTable)
      .where(this.scope(filters))
      .orderBy(desc(simulationsTable.createdAt), desc(simulationsTable.id))
      .limit(filters.limit)
      .offset(offset);
  }

  /** Counts simulations matching the same scope as `findPaginated`. */
  async count(filters: {
    ownerId: string;
    architectureId?: string;
    projectId?: string;
    saved: boolean;
  }): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(simulationsTable)
      .where(this.scope(filters));

    return Number(result?.count ?? 0);
  }

  /** Builds the shared ownership + optional-filter predicate for list reads. */
  private scope(filters: {
    ownerId: string;
    architectureId?: string;
    projectId?: string;
    saved: boolean;
  }) {
    return and(
      inArray(
        simulationsTable.architectureId,
        this.ownedArchitectures(filters.ownerId),
      ),
      filters.saved
        ? isNotNull(simulationsTable.savedAt)
        : isNull(simulationsTable.savedAt),
      filters.architectureId
        ? eq(simulationsTable.architectureId, filters.architectureId)
        : undefined,
      filters.projectId
        ? inArray(
            simulationsTable.architectureId,
            this.architecturesInProject(filters.projectId),
          )
        : undefined,
    );
  }

  /** Subquery selecting ids of architectures whose project is owned by the user. */
  private ownedArchitectures(ownerId: string) {
    return db
      .select({ id: architecturesTable.id })
      .from(architecturesTable)
      .where(
        inArray(
          architecturesTable.projectId,
          db
            .select({ id: projectsTable.id })
            .from(projectsTable)
            .where(eq(projectsTable.ownerId, ownerId)),
        ),
      );
  }

  /** Subquery selecting ids of architectures belonging to a single project. */
  private architecturesInProject(projectId: string) {
    return db
      .select({ id: architecturesTable.id })
      .from(architecturesTable)
      .where(eq(architecturesTable.projectId, projectId));
  }

  /**
   * Applies a lifecycle write only when the row's persisted status is one of
   * `from`. Returns the updated row, or `null` when no row matched (either the
   * id is unknown or the status guard rejected the transition) so callers can
   * treat a lost race as a conflict without a second read.
   */
  async transition(
    id: string,
    from: readonly SimulationStatus[],
    data: UpdateSimulationRecord,
  ): Promise<SimulationRow | null> {
    try {
      const [simulation] = await db
        .update(simulationsTable)
        .set(withRoundedTime(data))
        .where(
          and(
            eq(simulationsTable.id, id),
            inArray(simulationsTable.status, from),
          ),
        )
        .returning();

      return simulation ?? null;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  /**
   * Marks a simulation as saved without overwriting an existing saved timestamp.
   * Idempotent: saving an already-saved run returns the unchanged row.
   */
  async markSaved(id: string, savedAt: Date): Promise<SimulationRow | null> {
    try {
      const [simulation] = await db
        .update(simulationsTable)
        .set({ savedAt })
        .where(
          and(eq(simulationsTable.id, id), isNull(simulationsTable.savedAt)),
        )
        .returning();

      if (simulation) {
        return simulation;
      }

      const [existing] = await db
        .select()
        .from(simulationsTable)
        .where(eq(simulationsTable.id, id));

      return existing ?? null;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  /**
   * Deletes a non-active simulation row and returns it. The status guard is part
   * of the DELETE so a concurrent start cannot race a removal into deleting a
   * running/paused row. Returns `null` if the row is absent or active.
   */
  async delete(id: string): Promise<SimulationRow | null> {
    try {
      const [simulation] = await db
        .delete(simulationsTable)
        .where(
          and(
            eq(simulationsTable.id, id),
            notInArray(simulationsTable.status, ["running", "paused"]),
          ),
        )
        .returning();

      return simulation ?? null;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  /**
   * Marks every in-flight simulation (`running` or `paused`) as `failed` with
   * the given reason, returning the reconciled rows. Used at startup to
   * reconcile runs whose owning process is gone, since in-memory runtime state
   * is never restored.
   */
  async failInterrupted(reason: string): Promise<SimulationRow[]> {
    const now = new Date();

    try {
      return await db
        .update(simulationsTable)
        .set({ status: "failed", error: reason, completedAt: now })
        .where(inArray(simulationsTable.status, ["running", "paused"]))
        .returning();
    } catch (error) {
      throw mapDbError(error);
    }
  }
}
