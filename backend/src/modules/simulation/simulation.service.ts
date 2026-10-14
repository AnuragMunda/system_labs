/**
 * @file simulation.service.ts
 *
 * @description Business logic layer for the simulation module. It resolves the
 * target architecture and its parent project, enforces the same ownership and
 * visibility rules architectures use (writes require owning the project; reads
 * inherit the project's visibility), validates the requested traffic source
 * against the captured snapshot, and drives the orchestration layer. Controllers
 * never touch the orchestrator or the database directly.
 *
 * Simluations execute synchronously and in-process (there is no queue/worker
 * yet), so `start` runs to completion and persists the aggregate report.
 */

import type { Project } from "@/domain/project/project.types.js";
import type { SimulationMetrics } from "@/domain/simulation/metrics.types.js";
import type { SimulationStatus } from "@/domain/simulation/simulation.types.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/lib/apiError.js";
import {
  allowedFromStatuses,
  type LifecycleAction,
} from "@/simulation-engine/core/simulation-lifecycle.js";

import { ArchitectureRepository } from "../architecture/architecture.repository.js";
import { ProjectRepository } from "../project/project.repository.js";
import {
  CreateSimulationDto,
  SimulationDetails,
  SimulationResultView,
  SimulationStatusView,
} from "./simulation.dto.js";
import { SimulationOrchestrator } from "./simulation.orchestrator.js";
import type {
  SimulationReport,
  SimulationSnapshot,
} from "./simulation.orchestrator.types.js";
import {
  SimulationRepository,
  SimulationRow,
} from "./simulation.repository.js";

/** Coordinates simulation domain operations with persistence and orchestration. */
export class SimulationService {
  constructor(
    private readonly repository: SimulationRepository,
    private readonly architectureRepository: ArchitectureRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly orchestrator: SimulationOrchestrator,
  ) {}

  /**
   * Creates a simulation for an architecture the caller owns, capturing an
   * immutable snapshot of the architecture graph. The requested traffic source
   * is validated against that snapshot before anything is persisted.
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

    const seed = data.config.randomSeed ?? 0;

    const simulation = await this.repository.create({
      architectureId: architecture.id,
      status: "created",
      seed,
      currentTimeMs: 0,
      config: data.config,
      snapshot,
    });

    this.orchestrator.create({
      id: simulation.id,
      architectureId: architecture.id,
      architectureSnapshot: snapshot,
      config: data.config,
      sourceNodeId: data.sourceNodeId,
      seed,
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
      startedAt: simulation.startedAt,
      completedAt: simulation.completedAt,
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
   * Starts a created simulation and runs it to completion synchronously,
   * persisting the final lifecycle state and aggregate report. A run that fails
   * mid-execution is persisted as `failed` (with whatever metrics were
   * collected) before the error is surfaced.
   */
  async start(id: string, userId: string): Promise<SimulationResultView> {
    const simulation = await this.repository.findById(id);

    await this.assertOwnerForSimulation(simulation, userId);
    this.assertTransition(simulation.status, "start");

    const report = await this.runToCompletion(id);

    const updated = await this.repository.updateLifecycle(id, {
      status: report.simulation.status,
      currentTimeMs: report.simulation.currentTimeMs,
      startedAt: report.simulation.startedAt,
      completedAt: report.simulation.completedAt ?? new Date(),
      result: report.metrics,
    });

    return { simulation: this.toDetails(updated), metrics: report.metrics };
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
   * action is legal from the simulation's current status, then persists the
   * resulting state.
   */
  private async control(
    id: string,
    userId: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<SimulationDetails> {
    const simulation = await this.repository.findById(id);

    await this.assertOwnerForSimulation(simulation, userId);
    this.assertTransition(simulation.status, action);

    const snapshot = this.invokeOrchestrator(action, id);

    const updated = await this.repository.updateLifecycle(id, {
      status: snapshot.status,
      currentTimeMs: snapshot.currentTimeMs,
      completedAt: snapshot.completedAt,
    });

    return this.toDetails(updated);
  }

  /**
   * Runs a simulation to completion. A missing runtime is surfaced as a 409
   * without mutating the row; a genuine engine failure is persisted as `failed`
   * (with the metrics collected so far) and then rethrown.
   */
  private async runToCompletion(id: string): Promise<SimulationReport> {
    try {
      return this.orchestrator.run(id);
    } catch (error) {
      const runtimeError = this.mapRuntimeError(error);

      if (runtimeError !== error) {
        throw runtimeError;
      }

      await this.repository.updateLifecycle(id, {
        status: "failed",
        completedAt: new Date(),
        result: this.safeMetrics(id),
      });

      throw error;
    }
  }

  /** Wraps an orchestrator control call, mapping runtime-missing errors to 409. */
  private invokeOrchestrator(
    action: "pause" | "resume" | "cancel",
    id: string,
  ): SimulationSnapshot {
    try {
      switch (action) {
        case "pause":
          return this.orchestrator.pause(id);
        case "resume":
          return this.orchestrator.resume(id);
        case "cancel":
          return this.orchestrator.cancel(id);
      }
    } catch (error) {
      throw this.mapRuntimeError(error);
    }
  }

  /** Reads metrics defensively; returns undefined when the run is unavailable. */
  private safeMetrics(id: string): SimulationMetrics | undefined {
    try {
      return this.orchestrator.getMetrics(id);
    } catch {
      return undefined;
    }
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

  /**
   * Maps an orchestrator "not found" (a run that isn't registered in this
   * process, e.g. after a restart) to a 409, since the persisted row and the
   * live runtime disagree at that point.
   */
  private mapRuntimeError(error: unknown): unknown {
    if (
      error instanceof Error &&
      error.message.startsWith("Simulation not found:")
    ) {
      return ConflictError("Simulation runtime is not available.");
    }

    return error;
  }

  /** Strips the persisted report from a row before returning it as a DTO. */
  private toDetails(row: SimulationRow): SimulationDetails {
    return {
      id: row.id,
      architectureId: row.architectureId,
      status: row.status,
      seed: row.seed,
      currentTimeMs: row.currentTimeMs,
      config: row.config,
      snapshot: row.snapshot,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }
}
