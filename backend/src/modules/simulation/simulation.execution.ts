/**
 * @file simulation.execution.ts
 *
 * @description Execution management for simulations. Owns the lifecycle of a
 * run *after* it is claimed from the database: it reconstructs the run from the
 * persisted snapshot/config, drives the framework-independent orchestrator in
 * the background (decoupled from any HTTP request), and writes lifecycle
 * transitions back atomically.
 *
 * The database is the source of truth for lifecycle status. In-memory handles
 * exist only to cooperatively steer an in-flight run (pause/resume/cancel) and
 * are never a substitute for persisted state. A run is never resumed after a
 * restart: an interrupted run is reconciled to `failed` instead.
 *
 * There is no external queue/worker (deferred); execution happens inside the
 * API process but no longer within the request/response lifetime.
 */

import { logger } from "@/lib/logger.js";
import { allowedFromStatuses } from "@/simulation-engine/core/simulation-lifecycle.js";

import { SimulationOrchestrator } from "./simulation.orchestrator.js";
import {
  SimulationRepository,
  type SimulationRow,
} from "./simulation.repository.js";

/** How often (real ms) the persisted progress cursor is refreshed mid-run. */
const PROGRESS_FLUSH_INTERVAL_MS = 250;

/** Reason recorded when a run is abandoned because the process is shutting down. */
const SHUTDOWN_REASON = "interrupted by server shutdown";

/** Cooperative steering state for one in-flight run. */
interface ExecutionHandle {
  /** Set when the run has been cancelled; the loop stops without overwriting it. */
  cancelled: boolean;
  /** Set while the run is paused; the loop waits until it is resumed. */
  paused: boolean;
  /** Resolves a loop currently waiting for a paused run to resume. */
  resume?: () => void;
}

/** Yields to the event loop so I/O and HTTP requests are not starved. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class SimulationExecutionManager {
  private readonly handles = new Map<string, ExecutionHandle>();

  private readonly pending = new Set<Promise<void>>();

  private shuttingDown = false;

  constructor(
    private readonly repository: SimulationRepository,
    private readonly orchestrator: SimulationOrchestrator,
  ) {}

  /**
   * Atomically claims a `created` simulation for execution and schedules it in
   * the background. Returns the now-`running` row, or `null` when the row was
   * not `created` (unknown id, already running, or terminal) so the caller can
   * surface a conflict without a duplicate read.
   */
  async start(id: string): Promise<SimulationRow | null> {
    const row = await this.repository.transition(
      id,
      allowedFromStatuses("start"),
      {
        status: "running",
        startedAt: new Date(),
        completedAt: null,
        error: null,
      },
    );

    if (!row) {
      return null;
    }

    const handle: ExecutionHandle = { cancelled: false, paused: false };
    this.handles.set(id, handle);

    const task = this.execute(id, handle).catch((error: unknown) => {
      logger.error({ err: error, simulationId: id }, "Simulation task failed");
    });

    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));

    return row;
  }

  /** Pauses a running simulation, persisting the status and halting the loop. */
  async pause(id: string): Promise<SimulationRow | null> {
    const row = await this.repository.transition(
      id,
      allowedFromStatuses("pause"),
      { status: "paused" },
    );

    if (!row) {
      return null;
    }

    const handle = this.handles.get(id);

    if (handle) {
      handle.paused = true;
      this.orchestrator.pause(id);
    }

    return row;
  }

  /** Resumes a paused simulation, persisting the status and unblocking the loop. */
  async resume(id: string): Promise<SimulationRow | null> {
    const row = await this.repository.transition(
      id,
      allowedFromStatuses("resume"),
      { status: "running" },
    );

    if (!row) {
      return null;
    }

    const handle = this.handles.get(id);

    if (handle) {
      handle.paused = false;
      this.orchestrator.resume(id);
      handle.resume?.();
      handle.resume = undefined;
    }

    return row;
  }

  /**
   * Cancels a `created`, `running`, or `paused` simulation. The in-flight loop
   * observes the cancel signal between events and stops without overwriting the
   * persisted status.
   */
  async cancel(id: string): Promise<SimulationRow | null> {
    const row = await this.repository.transition(
      id,
      allowedFromStatuses("cancel"),
      { status: "cancelled", completedAt: new Date() },
    );

    if (!row) {
      return null;
    }

    const handle = this.handles.get(id);

    if (handle) {
      handle.cancelled = true;
      this.orchestrator.cancel(id);
      handle.resume?.();
      handle.resume = undefined;
    }

    return row;
  }

  /**
   * Stops accepting new work, marks every in-flight run as interrupted, and
   * waits for the background loops to settle. Safe to call once during
   * application shutdown.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    for (const handle of this.handles.values()) {
      handle.resume?.();
      handle.resume = undefined;
    }

    await this.awaitIdle();
  }

  /** Resolves once every scheduled execution has settled. Primarily for tests. */
  async awaitIdle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  /** Reconstructs the run, drives it to a terminal state, then releases it. */
  private async execute(id: string, handle: ExecutionHandle): Promise<void> {
    try {
      const row = await this.repository.findById(id);

      const { snapshot, config, sourceNodeId } = row;

      if (!snapshot || !config || !sourceNodeId) {
        throw new Error(
          `Simulation ${id} is missing the snapshot, config, or source node required to execute.`,
        );
      }

      this.orchestrator.create({
        id,
        architectureId: row.architectureId,
        architectureSnapshot: snapshot,
        config,
        sourceNodeId,
        seed: row.seed ?? 0,
      });

      this.orchestrator.start(id);

      await this.drive(id, handle);
    } catch (error) {
      await this.markFailed(id, handle, error);
    } finally {
      this.orchestrator.dispose(id);
      this.handles.delete(id);
    }
  }

  /** Steps the engine in chunks, flushing progress and honoring control signals. */
  private async drive(id: string, handle: ExecutionHandle): Promise<void> {
    let lastFlush = 0;

    for (;;) {
      if (this.shuttingDown) {
        await this.repository.transition(id, allowedFromStatuses("fail"), {
          status: "failed",
          error: SHUTDOWN_REASON,
          completedAt: new Date(),
        });
        return;
      }

      if (handle.cancelled) {
        return;
      }

      if (handle.paused) {
        await this.waitForResume(handle);
        continue;
      }

      const { processed, simulation } = this.orchestrator.step(id);

      if (!processed || simulation.status !== "running") {
        break;
      }

      const now = Date.now();

      if (now - lastFlush >= PROGRESS_FLUSH_INTERVAL_MS) {
        lastFlush = now;
        await this.repository.transition(id, ["running"], {
          currentTimeMs: simulation.currentTimeMs,
        });
        await yieldToEventLoop();
      }
    }

    const report = this.orchestrator.getReport(id);

    await this.repository.transition(id, allowedFromStatuses("complete"), {
      status: "completed",
      currentTimeMs: report.simulation.currentTimeMs,
      completedAt: report.simulation.completedAt ?? new Date(),
      result: report.metrics,
    });
  }

  /** Persists a failed run unless it was already cancelled by the caller. */
  private async markFailed(
    id: string,
    handle: ExecutionHandle,
    error: unknown,
  ): Promise<void> {
    if (handle.cancelled) {
      return;
    }

    try {
      await this.repository.transition(id, allowedFromStatuses("fail"), {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      });
    } catch (dbError) {
      logger.error(
        { err: dbError, simulationId: id },
        "Failed to persist simulation failure",
      );
    }
  }

  /** Blocks until the paused run is resumed. */
  private waitForResume(handle: ExecutionHandle): Promise<void> {
    return new Promise<void>((resolve) => {
      handle.resume = resolve;
    });
  }
}
