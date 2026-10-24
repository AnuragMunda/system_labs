/**
 * @file simulation.execution.test.ts
 *
 * @description Unit tests for SimulationExecutionManager. The repository and
 * orchestrator are mocked so the tests exercise the manager's own behavior:
 * atomic claims, background driving, cooperative pause/resume/cancel,
 * failure persistence, shutdown, and in-memory cleanup.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { SimulationExecutionManager } from "../../../../src/modules/simulation/simulation.execution.js";
import { SimulationRepository } from "../../../../src/modules/simulation/simulation.repository.js";
import { SimulationOrchestrator } from "../../../../src/modules/simulation/simulation.orchestrator.js";
import type { ArchitectureGraph } from "../../../../src/domain/architecture/architecture.types.js";
import type { SimulationConfig } from "../../../../src/domain/simulation/simulation.types.js";

type SimulationRow = Awaited<ReturnType<SimulationRepository["findById"]>>;

const simId = "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91";
const architectureId = "6a58bb24-2f9b-4e40-a1c5-4d2d5bce0f91";

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

const metrics = { simulationId: simId };

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
  savedAt: null,
  createdAt: new Date(),
};

const now = new Date("2026-01-01T00:00:01Z");

/** A snapshot for the orchestrator to return while a run is progressing. */
const runtimeSnapshot = {
  id: simId,
  architectureId,
  status: "running" as const,
  seed: 0,
  currentTimeMs: 500,
  config,
  startedAt: now,
  createdAt: now,
};

const repo = {
  create: vi.fn(),
  findById: vi.fn(),
  transition: vi.fn(),
  failInterrupted: vi.fn(),
} as unknown as SimulationRepository;

const orchestrator = {
  create: vi.fn(),
  start: vi.fn(),
  step: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  getReport: vi.fn(),
  dispose: vi.fn(),
} as unknown as SimulationOrchestrator;

let manager: SimulationExecutionManager;

/** Lets queued microtasks/timers run so the background loop can progress. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.resetAllMocks();
  manager = new SimulationExecutionManager(repo, orchestrator);

  vi.mocked(repo.transition).mockImplementation(async (id, _from, data) => ({
    ...row,
    ...data,
    id,
  }));

  vi.mocked(orchestrator.step).mockReturnValue({
    processed: false,
    simulation: { ...runtimeSnapshot, completedAt: now },
  });

  vi.mocked(orchestrator.getReport).mockReturnValue({
    simulation: {
      ...runtimeSnapshot,
      status: "completed",
      currentTimeMs: 1000,
      completedAt: now,
    },
    metrics: metrics as never,
  });
});

describe("SimulationExecutionManager.start", () => {
  it("claims the run, executes it in the background, and disposes the runtime", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);

    const claimed = await manager.start(simId);

    expect(claimed).toMatchObject({ status: "running" });
    expect(repo.transition).toHaveBeenCalledWith(
      simId,
      ["created"],
      expect.objectContaining({ status: "running" }),
    );

    await manager.awaitIdle();

    expect(orchestrator.create).toHaveBeenCalledWith({
      id: simId,
      architectureId,
      architectureSnapshot: graph,
      config,
      sourceNodeId: "client-1",
      seed: 0,
    });
    expect(orchestrator.start).toHaveBeenCalledWith(simId);
    expect(repo.transition).toHaveBeenCalledWith(
      simId,
      ["running"],
      expect.objectContaining({ status: "completed", result: metrics }),
    );
    expect(orchestrator.dispose).toHaveBeenCalledWith(simId);
  });

  it("returns null when the run was not in a claimable state", async () => {
    vi.mocked(repo.transition).mockResolvedValueOnce(null);

    await expect(manager.start(simId)).resolves.toBeNull();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("persists a failure when the run cannot be reconstructed", async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...row,
      snapshot: null,
      config: null,
    });

    await manager.start(simId);
    await manager.awaitIdle();

    expect(orchestrator.create).not.toHaveBeenCalled();
    expect(repo.transition).toHaveBeenCalledWith(
      simId,
      ["created", "running", "paused"],
      expect.objectContaining({ status: "failed" }),
    );
    expect(orchestrator.dispose).toHaveBeenCalledWith(simId);
  });

  it("persists the engine error message when execution throws", async () => {
    vi.mocked(repo.findById).mockResolvedValue(row);
    vi.mocked(orchestrator.create).mockImplementation(() => {
      throw new Error("engine exploded");
    });

    await manager.start(simId);
    await manager.awaitIdle();

    expect(repo.transition).toHaveBeenCalledWith(
      simId,
      ["created", "running", "paused"],
      expect.objectContaining({ status: "failed", error: "engine exploded" }),
    );
    expect(orchestrator.dispose).toHaveBeenCalledWith(simId);
  });
});

describe("SimulationExecutionManager control actions", () => {
  /** Starts a run whose step loop keeps running until told to stop. */
  async function startLiveRun() {
    let processed = true;
    vi.mocked(repo.findById).mockResolvedValue(row);
    vi.mocked(orchestrator.step).mockImplementation(() => ({
      processed,
      simulation: { ...runtimeSnapshot, completedAt: now },
    }));

    await manager.start(simId);
    await tick();

    return () => {
      processed = false;
    };
  }

  it("pauses a live run and steers the orchestrator", async () => {
    const stop = await startLiveRun();

    const result = await manager.pause(simId);

    expect(repo.transition).toHaveBeenCalledWith(simId, ["running"], {
      status: "paused",
    });
    expect(orchestrator.pause).toHaveBeenCalledWith(simId);
    expect(result).toMatchObject({ status: "paused" });

    await manager.cancel(simId);
    stop();
    await manager.awaitIdle();
  });

  it("resumes a paused live run and steers the orchestrator", async () => {
    const stop = await startLiveRun();

    await manager.pause(simId);
    stop();

    const result = await manager.resume(simId);

    expect(repo.transition).toHaveBeenCalledWith(simId, ["paused"], {
      status: "running",
    });
    expect(orchestrator.resume).toHaveBeenCalledWith(simId);
    expect(result).toMatchObject({ status: "running" });

    await manager.awaitIdle();
  });

  it("cancels a live run and steers the orchestrator", async () => {
    const stop = await startLiveRun();

    const result = await manager.cancel(simId);

    expect(repo.transition).toHaveBeenCalledWith(
      simId,
      ["created", "running", "paused"],
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(orchestrator.cancel).toHaveBeenCalledWith(simId);
    expect(result).toMatchObject({ status: "cancelled" });

    stop();
    await manager.awaitIdle();
  });

  it("does not steer the orchestrator when a pause loses the race", async () => {
    vi.mocked(repo.transition).mockResolvedValueOnce(null);

    await expect(manager.pause(simId)).resolves.toBeNull();
    expect(orchestrator.pause).not.toHaveBeenCalled();
  });
});

describe("SimulationExecutionManager.shutdown", () => {
  it("marks a run scheduled after shutdown as interrupted", async () => {
    await manager.shutdown();

    vi.mocked(repo.findById).mockResolvedValue(row);
    await manager.start(simId);
    await manager.awaitIdle();

    expect(repo.transition).toHaveBeenCalledWith(
      simId,
      ["created", "running", "paused"],
      expect.objectContaining({
        status: "failed",
        error: "interrupted by server shutdown",
      }),
    );
    expect(orchestrator.dispose).toHaveBeenCalledWith(simId);
  });
});
