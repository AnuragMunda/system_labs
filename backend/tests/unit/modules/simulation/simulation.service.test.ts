/**
 * @file simulation.service.test.ts
 *
 * @description Unit tests for SimulationService. The repositories and the
 * execution manager are mocked, so the tests focus on the business rules:
 * ownership for create/controls, project-visibility reads, source-node
 * validation, lifecycle guards, and delegation of lifecycle transitions.
 * Background execution itself is covered by simulation.execution.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { SimulationService } from "../../../../src/modules/simulation/simulation.service.js";
import { SimulationRepository } from "../../../../src/modules/simulation/simulation.repository.js";
import { SimulationExecutionManager } from "../../../../src/modules/simulation/simulation.execution.js";
import { ArchitectureRepository } from "../../../../src/modules/architecture/architecture.repository.js";
import { ProjectRepository } from "../../../../src/modules/project/project.repository.js";
import { NotFoundError } from "../../../../src/lib/index.js";
import type { ArchitectureGraph } from "../../../../src/domain/architecture/architecture.types.js";
import type { SimulationConfig } from "../../../../src/domain/simulation/simulation.types.js";

type SimulationRow = Awaited<ReturnType<SimulationRepository["findById"]>>;
type ArchitectureRow = Awaited<ReturnType<ArchitectureRepository["findById"]>>;
type ProjectRow = Awaited<ReturnType<ProjectRepository["findById"]>>;

const simId = "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91";
const architectureId = "6a58bb24-2f9b-4e40-a1c5-4d2d5bce0f91";
const projectId = "7c69bb24-2f9b-4e40-a1c5-4d2d5bce0f91";
const ownerId = "8d78bb24-2f9b-4e40-a1c5-4d2d5bce0f91";
const otherUserId = "9e88bb24-2f9b-4e40-a1c5-4d2d5bce0f91";

const config: SimulationConfig = {
  durationMs: 1000,
  requestsPerSecond: 10,
  simulationSpeed: 1,
  collectMetrics: true,
  emitEvents: true,
};

const graph: ArchitectureGraph = {
  nodes: [
    {
      id: "client-1",
      type: "load_balancer",
      name: "Client",
      position: { x: 0, y: 0 },
      config: {},
    },
  ],
  edges: [],
};

const dto = { architectureId, sourceNodeId: "client-1", config };

const architecture: ArchitectureRow = {
  id: architectureId,
  projectId,
  name: "System",
  description: null,
  graph,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const project: ProjectRow = {
  id: projectId,
  ownerId,
  name: "System Lab",
  description: null,
  visibility: "PRIVATE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const row: SimulationRow = {
  id: simId,
  architectureId,
  status: "created",
  seed: 0,
  currentTimeMs: 0,
  sourceNodeId: "client-1",
  config,
  snapshot: graph,
  result: null,
  startedAt: null,
  completedAt: null,
  error: null,
  createdAt: new Date(),
};

const repo = {
  create: vi.fn(),
  findById: vi.fn(),
} as unknown as SimulationRepository;

const archRepo = { findById: vi.fn() } as unknown as ArchitectureRepository;

const projectRepo = { findById: vi.fn() } as unknown as ProjectRepository;

const execution = {
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
} as unknown as SimulationExecutionManager;

const service = new SimulationService(repo, archRepo, projectRepo, execution);

/** Stubs the architecture + project lookups for an owned simulation. */
function stubsOwned() {
  vi.mocked(archRepo.findById).mockResolvedValue(architecture);
  vi.mocked(projectRepo.findById).mockResolvedValue(project);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SimulationService.create", () => {
  it("validates the source node and persists the run with its source node", async () => {
    stubsOwned();
    vi.mocked(repo.create).mockResolvedValue(row);

    const result = await service.create(ownerId, dto);

    expect(archRepo.findById).toHaveBeenCalledWith(architectureId);
    expect(projectRepo.findById).toHaveBeenCalledWith(projectId);
    expect(repo.create).toHaveBeenCalledWith({
      architectureId,
      status: "created",
      seed: 0,
      currentTimeMs: 0,
      sourceNodeId: "client-1",
      config,
      snapshot: graph,
    });
    expect(result).toEqual({
      id: simId,
      architectureId,
      status: "created",
      seed: 0,
      currentTimeMs: 0,
      sourceNodeId: "client-1",
      config,
      snapshot: graph,
      startedAt: null,
      completedAt: null,
      error: null,
      createdAt: row.createdAt,
    });
  });

  it("derives the persisted seed from config.randomSeed", async () => {
    stubsOwned();
    vi.mocked(repo.create).mockResolvedValue(row);

    await service.create(ownerId, {
      ...dto,
      config: { ...config, randomSeed: 42 },
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ seed: 42 }),
    );
  });

  it("rejects a source node that is not in the snapshot with a 400", async () => {
    stubsOwned();

    const promise = service.create(ownerId, {
      ...dto,
      sourceNodeId: "missing",
    });

    await expect(promise).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects creating a run under a project owned by someone else with a 403", async () => {
    stubsOwned();

    const promise = service.create(otherUserId, dto);

    await expect(promise).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("propagates NotFoundError when the architecture does not exist", async () => {
    vi.mocked(archRepo.findById).mockRejectedValue(NotFoundError());

    await expect(service.create(ownerId, dto)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("SimulationService.findById", () => {
  it("returns details without the persisted report for the owner", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    const result = await service.findById(simId, ownerId);

    expect(result).toEqual({
      id: simId,
      architectureId,
      status: "created",
      seed: 0,
      currentTimeMs: 0,
      sourceNodeId: "client-1",
      config,
      snapshot: graph,
      startedAt: null,
      completedAt: null,
      error: null,
      createdAt: row.createdAt,
    });
    expect("result" in result).toBe(false);
  });

  it("allows anyone to read a run under a PUBLIC project", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    vi.mocked(archRepo.findById).mockResolvedValue(architecture);
    vi.mocked(projectRepo.findById).mockResolvedValue({
      ...project,
      visibility: "PUBLIC",
    });

    await expect(service.findById(simId, otherUserId)).resolves.toMatchObject({
      id: simId,
    });
  });

  it("hides a run under a PRIVATE project from a non-owner with a 404", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.findById(simId, otherUserId)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });

  it("hides a run under a PRIVATE project from an anonymous caller with a 404", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.findById(simId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("propagates NotFoundError when the run does not exist", async () => {
    vi.mocked(repo.findById).mockRejectedValue(NotFoundError());

    await expect(service.findById(simId, ownerId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("SimulationService.getStatus", () => {
  it("returns the status view for an authorized reader", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      status: "running",
      currentTimeMs: 250,
      startedAt,
    });
    stubsOwned();

    const result = await service.getStatus(simId, ownerId);

    expect(result).toEqual({
      id: simId,
      status: "running",
      currentTimeMs: 250,
      startedAt,
      completedAt: null,
      error: null,
    });
  });

  it("surfaces a failure reason for a failed run", async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      status: "failed",
      error: "engine exploded",
    });
    stubsOwned();

    const result = await service.getStatus(simId, ownerId);

    expect(result).toMatchObject({
      status: "failed",
      error: "engine exploded",
    });
  });

  it("enforces visibility", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.getStatus(simId, otherUserId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("SimulationService.getResults", () => {
  it("returns the details and persisted metrics for an authorized reader", async () => {
    const metrics = { simulationId: simId };
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      status: "completed",
      result: metrics as never,
    });
    stubsOwned();

    const result = await service.getResults(simId, ownerId);

    expect(result.metrics).toBe(metrics);
    expect(result.simulation).toMatchObject({ id: simId, status: "completed" });
  });

  it("throws NotFoundError until a report has been persisted", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.getResults(simId, ownerId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("enforces visibility before returning results", async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      result: {} as never,
    });
    stubsOwned();

    await expect(service.getResults(simId, otherUserId)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("SimulationService.start", () => {
  it("delegates to the execution manager and returns the running details", async () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();
    vi.mocked(execution.start).mockResolvedValue({
      ...row,
      status: "running",
      startedAt,
    });

    const result = await service.start(simId, ownerId);

    expect(execution.start).toHaveBeenCalledWith(simId);
    expect(result).toMatchObject({ id: simId, status: "running", startedAt });
  });

  it("rejects a non-owner with a 403 and does not start the simulation", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.start(simId, otherUserId)).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
    expect(execution.start).not.toHaveBeenCalled();
  });

  it("rejects starting a run that is already terminal with a 409", async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      status: "completed",
    });
    stubsOwned();

    await expect(service.start(simId, ownerId)).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
    expect(execution.start).not.toHaveBeenCalled();
  });

  it("maps a lost claim race to a 409", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();
    vi.mocked(execution.start).mockResolvedValue(null);

    await expect(service.start(simId, ownerId)).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
  });
});

describe("SimulationService control actions", () => {
  it("pauses a running simulation via the execution manager", async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...row, status: "running" });
    stubsOwned();
    vi.mocked(execution.pause).mockResolvedValue({
      ...row,
      status: "paused",
    });

    const result = await service.pause(simId, ownerId);

    expect(execution.pause).toHaveBeenCalledWith(simId);
    expect(result.status).toBe("paused");
  });

  it("resumes a paused simulation via the execution manager", async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...row, status: "paused" });
    stubsOwned();
    vi.mocked(execution.resume).mockResolvedValue({
      ...row,
      status: "running",
    });

    const result = await service.resume(simId, ownerId);

    expect(execution.resume).toHaveBeenCalledWith(simId);
    expect(result.status).toBe("running");
  });

  it("cancels a created simulation via the execution manager", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();
    vi.mocked(execution.cancel).mockResolvedValue({
      ...row,
      status: "cancelled",
    });

    const result = await service.cancel(simId, ownerId);

    expect(execution.cancel).toHaveBeenCalledWith(simId);
    expect(result.status).toBe("cancelled");
  });

  it("rejects pausing a created simulation with a 409", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.pause(simId, ownerId)).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
    expect(execution.pause).not.toHaveBeenCalled();
  });

  it("rejects resuming a created simulation with a 409", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    stubsOwned();

    await expect(service.resume(simId, ownerId)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(execution.resume).not.toHaveBeenCalled();
  });

  it("rejects cancelling a completed simulation with a 409", async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      status: "completed",
    });
    stubsOwned();

    await expect(service.cancel(simId, ownerId)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(execution.cancel).not.toHaveBeenCalled();
  });

  it("rejects control actions from a non-owner with a 403", async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...row, status: "running" });
    stubsOwned();

    await expect(service.pause(simId, otherUserId)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(execution.pause).not.toHaveBeenCalled();
  });

  it("maps a lost control race to a 409", async () => {
    vi.mocked(repo.findById).mockResolvedValue({ ...row, status: "running" });
    stubsOwned();
    vi.mocked(execution.pause).mockResolvedValue(null);

    await expect(service.pause(simId, ownerId)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
