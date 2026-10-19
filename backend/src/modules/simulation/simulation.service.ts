/**
 * @file simulation.service.ts
 *
 * @description Business logic layer for the simulation module. It resolves the
 * target architecture and its parent project, enforces the same ownership and
 * visibility rules architectures use (writes require owning the project; reads
 * inherit the project's visibility), validates the requested traffic source
 * against the captured snapshot, and drives execution management. Controllers
 * never touch the execution manager or the database directly.
 *
 * Execution is asynchronous and detached from the HTTP request: `start` atomically
 * claims a run and returns immediately, while `SimulationExecutionManager` drives
 * it in the background and persists its lifecycle.
 */

import type { Project } from "@/domain/project/project.types.js";
import type { SimulationStatus } from "@/domain/simulation/simulation.types.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/apiError.js";
import type { SimulationMetrics } from "@/domain/simulation/metrics.types.js";
import {
  allowedFromStatuses,
  type LifecycleAction,
} from "@/simulation-engine/core/simulation-lifecycle.js";

import { ArchitectureRepository } from "../architecture/architecture.repository.js";
import { ProjectRepository } from "../project/project.repository.js";
import {
  CreateSimulationDto,
  ListSimulationsQueryDto,
  PaginatedResult,
  SimulationDetails,
  SimulationResultView,
  SimulationStatusView,
  SimulationSummary,
} from "./simulation.dto.js";
import { SimulationExecutionManager } from "./simulation.execution.js";
import {
  SimulationRepository,
  SimulationRow,
} from "./simulation.repository.js";

/** Coordinates simulation domain operations with persistence and execution. */
export class SimulationService {
  constructor(
    private readonly repository: SimulationRepository,
    private readonly architectureRepository: ArchitectureRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly execution: SimulationExecutionManager,
  ) {}

  /**
   * Creates a simulation for an architecture the caller owns, capturing an
   * immutable snapshot of the architecture graph. The requested traffic source
   * and every scheduled failure node are validated against that snapshot before
   * anything is persisted.
   */
  async create(
    userId: string,
    data: CreateSimulationDto,
  ): Promise<SimulationDetails> {
    const architecture = await this.architectureRepository.findById(
      data.architectureId,
    );
    const project = await this.projectRepository.findById(
      architecture.projectId,
    );

    this.assertOwner(project, userId);

    const snapshot = architecture.graph;

    if (!snapshot.nodes.some((node) => node.id === data.sourceNodeId)) {
      throw BadRequestError(
        `Traffic source node not found in architecture: ${data.sourceNodeId}`,
      );
    }

    for (const failure of data.config.failures ?? []) {
      if (!snapshot.nodes.some((node) => node.id === failure.nodeId)) {
        throw BadRequestError(
          `Failure node not found in architecture: ${failure.nodeId}`,
        );
      }
    }

    const seed = data.config.randomSeed ?? 0;

    const simulation = await this.repository.create({
      architectureId: architecture.id,
      status: "created",
      seed,
      currentTimeMs: 0,
      sourceNodeId: data.sourceNodeId,
      config: data.config,
      snapshot,
    });

    return this.toDetails(simulation);
  }

  /** Fetches a simulation's details, enforcing the parent project's visibility. */
  async findById(id: string, userId?: string): Promise<SimulationDetails> {
    const simulation = await this.repository.findById(id);

    await this.assertCanRead(simulation, userId);

    return this.toDetails(simulation);
  }

  /** Returns a simulation's lifecycle status, enforcing project visibility. */
  async getStatus(id: string, userId?: string): Promise<SimulationStatusView> {
    const simulation = await this.repository.findById(id);

    await this.assertCanRead(simulation, userId);

    return {
      id: simulation.id,
      status: simulation.status,
      currentTimeMs: simulation.currentTimeMs,
      durationMs: simulation.config?.durationMs ?? null,
      startedAt: simulation.startedAt,
      completedAt: simulation.completedAt,
      error: simulation.error,
    };
  }

  /**
   * Returns a simulation's metrics at its current virtual time while it is
   * in-flight, or the persisted aggregate report once it has completed. This
   * powers the live run view: callers poll it while the run is active to get
   * per-component traffic, latency, queue depth, and health.
   */
  async getMetrics(id: string, userId?: string): Promise<SimulationMetrics> {
    const simulation = await this.repository.findById(id);

    await this.assertCanRead(simulation, userId);

    // Live snapshots only exist for a run that has been claimed for execution.
    if (simulation.status === "created") {
      throw ConflictError("Simulation has not been started.");
    }

    const live = this.execution.getLiveMetrics(id);

    if (live) {
      return live;
    }

    // The run is no longer in memory (completed/failed/cancelled or after a
    // restart); fall back to the persisted aggregate report when one exists.
    if (simulation.result !== null) {
      return simulation.result;
    }

    // Active in the DB but not yet in memory (still spinning up) — a transient
    // state the caller should simply retry on the next poll.
    if (simulation.status === "running" || simulation.status === "paused") {
      throw ConflictError("Simulation metrics are not ready yet.");
    }

    throw NotFoundError();
  }

  /**
   * Returns a page of the caller's simulations, newest first, optionally scoped
   * to a single architecture and/or project, along with pagination metadata.
   * Each item is a lightweight summary; the captured snapshot and config are
   * never included.
   */
  async getPaginated(
    userId: string,
    query: ListSimulationsQueryDto,
  ): Promise<PaginatedResult<SimulationSummary>> {
    const { architectureId, projectId, page, limit } = query;

    const [items, total] = await Promise.all([
      this.repository.findPaginated({
        ownerId: userId,
        architectureId,
        projectId,
        page,
        limit,
      }),
      this.repository.count({ ownerId: userId, architectureId, projectId }),
    ]);

    return {
      items: items.map((row) => this.toSummary(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Returns a simulation's details together with its persisted aggregate
   * report. Results only exist once a run has completed or failed.
   */
  async getResults(id: string, userId?: string): Promise<SimulationResultView> {
    const simulation = await this.repository.findById(id);

    await this.assertCanRead(simulation, userId);

    if (simulation.result === null) {
      throw NotFoundError();
    }

    return {
      simulation: this.toDetails(simulation),
      metrics: simulation.result,
    };
  }

  /**
   * Claims a created simulation and schedules it to run in the background,
   * returning the now-`running` details. A run that fails mid-execution is
   * persisted as `failed` by the execution manager and surfaced through the
   * status/results endpoints.
   */
  async start(id: string, userId: string): Promise<SimulationDetails> {
    const simulation = await this.repository.findById(id);

    await this.assertOwnerForSimulation(simulation, userId);
    this.assertTransition(simulation.status, "start");

    const claimed = await this.execution.start(id);

    return this.toDetails(this.assertApplied(claimed, "start"));
  }

  /** Pauses a running simulation the caller owns. */
  async pause(id: string, userId: string): Promise<SimulationDetails> {
    return this.control(id, userId, "pause");
  }

  /** Resumes a paused simulation the caller owns. */
  async resume(id: string, userId: string): Promise<SimulationDetails> {
    return this.control(id, userId, "resume");
  }

  /** Cancels a created, running, or paused simulation the caller owns. */
  async cancel(id: string, userId: string): Promise<SimulationDetails> {
    return this.control(id, userId, "cancel");
  }

  /**
   * Applies a lifecycle control action after verifying ownership and that the
   * action is legal from the simulation's current status, then delegates the
   * atomic transition to the execution manager.
   */
  private async control(
    id: string,
    userId: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<SimulationDetails> {
    const simulation = await this.repository.findById(id);

    await this.assertOwnerForSimulation(simulation, userId);
    this.assertTransition(simulation.status, action);

    const updated = await this.execution[action](id);

    return this.toDetails(this.assertApplied(updated, action));
  }

  /**
   * Throws ConflictError when a status-scoped transition did not apply, which
   * means another operation changed the run's status first.
   */
  private assertApplied(
    row: SimulationRow | null,
    action: LifecycleAction,
  ): SimulationRow {
    if (!row) {
      throw ConflictError(`Simulation could not ${action}.`);
    }

    return row;
  }

  /** Throws ForbiddenError unless the user owns the given project. */
  private assertOwner(project: Project, userId: string): void {
    if (project.ownerId !== userId) {
      throw ForbiddenError();
    }
  }

  /** Loads a simulation's project and requires the caller to own it. */
  private async assertOwnerForSimulation(
    simulation: SimulationRow,
    userId: string,
  ): Promise<void> {
    const project = await this.loadProject(simulation);

    this.assertOwner(project, userId);
  }

  /**
   * Throws NotFoundError when a non-owner reads a simulation whose project is
   * PRIVATE, so its existence stays hidden.
   */
  private async assertCanRead(
    simulation: SimulationRow,
    userId?: string,
  ): Promise<void> {
    const project = await this.loadProject(simulation);

    if (project.ownerId !== userId && project.visibility === "PRIVATE") {
      throw NotFoundError();
    }
  }

  /** Resolves the project a simulation ultimately belongs to. */
  private async loadProject(simulation: SimulationRow): Promise<Project> {
    const architecture = await this.architectureRepository.findById(
      simulation.architectureId,
    );

    return this.projectRepository.findById(architecture.projectId);
  }

  /** Throws ConflictError when the action is illegal from the current status. */
  private assertTransition(
    status: SimulationStatus,
    action: LifecycleAction,
  ): void {
    if (!allowedFromStatuses(action).includes(status)) {
      throw ConflictError(`Simulation cannot ${action} from status ${status}.`);
    }
  }

  /** Strips the persisted report from a row before returning it as a DTO. */
  private toDetails(row: SimulationRow): SimulationDetails {
    return {
      id: row.id,
      architectureId: row.architectureId,
      status: row.status,
      seed: row.seed,
      currentTimeMs: row.currentTimeMs,
      sourceNodeId: row.sourceNodeId,
      config: row.config,
      snapshot: row.snapshot,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      error: row.error,
      createdAt: row.createdAt,
    };
  }

  /** Maps a row to the lightweight summary used by list responses. */
  private toSummary(row: SimulationRow): SimulationSummary {
    return {
      id: row.id,
      architectureId: row.architectureId,
      status: row.status,
      seed: row.seed,
      currentTimeMs: row.currentTimeMs,
      durationMs: row.config?.durationMs ?? null,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      error: row.error,
      createdAt: row.createdAt,
    };
  }
}
