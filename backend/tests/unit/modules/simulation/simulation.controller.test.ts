/**
 * @file simulation.controller.test.ts
 *
 * @description Unit tests for the simulation HTTP handlers. The service is
 * mocked so each handler's auth gate, path-param validation, status codes, and
 * error forwarding can be exercised in isolation.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("@/modules/simulation/index.js", () => ({
  simulationService: {
    create: vi.fn(),
    findById: vi.fn(),
    getStatus: vi.fn(),
    getMetrics: vi.fn(),
    getResults: vi.fn(),
    getPaginated: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  },
}));

const { simulationService } =
  await import("../../../../src/modules/simulation/index.js");
const {
  createSimulation,
  getSimulations,
  getSimulationById,
  getSimulationStatus,
  getSimulationMetrics,
  getSimulationResults,
  startSimulation,
  pauseSimulation,
  resumeSimulation,
  cancelSimulation,
  saveSimulation,
  deleteSimulation,
} = await import("../../../../src/modules/simulation/simulation.controller.js");
import { ApiError } from "../../../../src/lib/index.js";

const uuid = "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91";

/** Returns a fake Express response with chainable status/json mocks. */
function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

/** Returns a mocked Express next function. */
function mockNext() {
  return vi.fn() as unknown as NextFunction;
}

/** Returns an authenticated request carrying the fixture user. */
function mockAuthReq(partial: Partial<Request> = {}): Request {
  return {
    user: { id: uuid, email: "owner@test.local", sessionId: uuid },
    ...partial,
  } as unknown as Request;
}

/** Waits for the microtask queue so async handler promises settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSimulation", () => {
  const body = {
    architectureId: uuid,
    sourceNodeId: "client-1",
    config: { durationMs: 1000, requestsPerSecond: 10 },
  };

  it("creates a simulation for the caller and responds with 201", async () => {
    const req = mockAuthReq({ body });
    const res = mockRes();
    const next = mockNext();

    const created = { id: uuid, ...body };
    vi.mocked(simulationService.create).mockResolvedValue(created as never);

    await createSimulation(req, res, next);
    await flush();

    expect(simulationService.create).toHaveBeenCalledWith(uuid, body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Simulation created successfully",
      data: created,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes an UnauthorizedError to next when there is no user", async () => {
    const req = { body } as Request;
    const res = mockRes();
    const next = mockNext();

    await createSimulation(req, res, next);
    await flush();

    expect(simulationService.create).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("passes a service error to next", async () => {
    const req = mockAuthReq({ body });
    const res = mockRes();
    const next = mockNext();

    const error = new Error("db down");
    vi.mocked(simulationService.create).mockRejectedValue(error as never);

    await createSimulation(req, res, next);
    await flush();

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(error));
  });
});

describe("getSimulations", () => {
  it("lists the caller's simulations with parsed query defaults", async () => {
    const req = mockAuthReq({ query: {} });
    const res = mockRes();
    const next = mockNext();

    const page = {
      items: [{ id: uuid }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    vi.mocked(simulationService.getPaginated).mockResolvedValue(page as never);

    await getSimulations(req, res, next);
    await flush();

    expect(simulationService.getPaginated).toHaveBeenCalledWith(uuid, {
      saved: true,
      page: 1,
      limit: 20,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Request successful",
      data: page,
    });
  });

  it("coerces and forwards filters", async () => {
    const req = mockAuthReq({
      query: { architectureId: uuid, projectId: uuid, page: "2", limit: "5" },
    });
    const res = mockRes();
    const next = mockNext();

    vi.mocked(simulationService.getPaginated).mockResolvedValue({
      items: [],
      pagination: { page: 2, limit: 5, total: 0, totalPages: 0 },
    } as never);

    await getSimulations(req, res, next);
    await flush();

    expect(simulationService.getPaginated).toHaveBeenCalledWith(uuid, {
      architectureId: uuid,
      projectId: uuid,
      saved: true,
      page: 2,
      limit: 5,
    });
  });

  it("passes a BadRequestError to next for an invalid query", async () => {
    const req = mockAuthReq({ query: { limit: "999" } });
    const res = mockRes();
    const next = mockNext();

    await getSimulations(req, res, next);
    await flush();

    expect(simulationService.getPaginated).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  });

  it("passes an UnauthorizedError to next when there is no user", async () => {
    const req = { query: {} } as unknown as Request;
    const res = mockRes();
    const next = mockNext();

    await getSimulations(req, res, next);
    await flush();

    expect(simulationService.getPaginated).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
  });
});

describe("getSimulationById", () => {
  it("fetches with the caller's id and responds with 200", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const found = { id: uuid, status: "created" };
    vi.mocked(simulationService.findById).mockResolvedValue(found as never);

    await getSimulationById(req, res, next);
    await flush();

    expect(simulationService.findById).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Request successful",
      data: found,
    });
  });

  it("fetches anonymously when no user is present", async () => {
    const req = { params: { id: uuid } } as unknown as Request;
    const res = mockRes();
    const next = mockNext();

    vi.mocked(simulationService.findById).mockResolvedValue({} as never);

    await getSimulationById(req, res, next);
    await flush();

    expect(simulationService.findById).toHaveBeenCalledWith(uuid, undefined);
  });

  it("passes a BadRequestError to next for an invalid id", async () => {
    const req = mockAuthReq({ params: { id: "not-a-uuid" } });
    const res = mockRes();
    const next = mockNext();

    await getSimulationById(req, res, next);
    await flush();

    expect(simulationService.findById).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  });
});

describe("getSimulationStatus", () => {
  it("responds with 200 and the status view", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const status = { id: uuid, status: "running", currentTimeMs: 10 };
    vi.mocked(simulationService.getStatus).mockResolvedValue(status as never);

    await getSimulationStatus(req, res, next);
    await flush();

    expect(simulationService.getStatus).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Request successful",
      data: status,
    });
  });

  it("passes a BadRequestError to next for an invalid id", async () => {
    const req = mockAuthReq({ params: { id: "nope" } });
    const res = mockRes();
    const next = mockNext();

    await getSimulationStatus(req, res, next);
    await flush();

    expect(simulationService.getStatus).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 400 });
  });
});

describe("getSimulationMetrics", () => {
  it("responds with 200 and the metrics snapshot", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const metrics = { simulationId: uuid, recordedAtMs: 10 };
    vi.mocked(simulationService.getMetrics).mockResolvedValue(metrics as never);

    await getSimulationMetrics(req, res, next);
    await flush();

    expect(simulationService.getMetrics).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Request successful",
      data: metrics,
    });
  });

  it("passes a service error to next", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const error = new Error("not ready");
    vi.mocked(simulationService.getMetrics).mockRejectedValue(error as never);

    await getSimulationMetrics(req, res, next);
    await flush();

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(error));
  });

  it("passes a BadRequestError to next for an invalid id", async () => {
    const req = mockAuthReq({ params: { id: "nope" } });
    const res = mockRes();
    const next = mockNext();

    await getSimulationMetrics(req, res, next);
    await flush();

    expect(simulationService.getMetrics).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 400 });
  });
});

describe("getSimulationResults", () => {
  it("responds with 200 and the result view", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const result = {
      simulation: { id: uuid },
      metrics: { simulationId: uuid },
    };
    vi.mocked(simulationService.getResults).mockResolvedValue(result as never);

    await getSimulationResults(req, res, next);
    await flush();

    expect(simulationService.getResults).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Request successful",
      data: result,
    });
  });

  it("passes a service error to next", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const error = new Error("not ready");
    vi.mocked(simulationService.getResults).mockRejectedValue(error as never);

    await getSimulationResults(req, res, next);
    await flush();

    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(error));
  });
});

describe("startSimulation", () => {
  it("starts the simulation for the caller and responds with 202", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const simulation = { id: uuid, status: "running" };
    vi.mocked(simulationService.start).mockResolvedValue(simulation as never);

    await startSimulation(req, res, next);
    await flush();

    expect(simulationService.start).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Simulation started successfully",
      data: simulation,
    });
  });

  it("passes an UnauthorizedError to next when there is no user", async () => {
    const req = { params: { id: uuid } } as unknown as Request;
    const res = mockRes();
    const next = mockNext();

    await startSimulation(req, res, next);
    await flush();

    expect(simulationService.start).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
  });

  it("passes a BadRequestError to next for an invalid id", async () => {
    const req = mockAuthReq({ params: { id: "nope" } });
    const res = mockRes();
    const next = mockNext();

    await startSimulation(req, res, next);
    await flush();

    expect(simulationService.start).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 400 });
  });
});

describe("pauseSimulation / resumeSimulation / cancelSimulation", () => {
  it("pauses and responds with 200", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    vi.mocked(simulationService.pause).mockResolvedValue({} as never);

    await pauseSimulation(req, res, next);
    await flush();

    expect(simulationService.pause).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Simulation paused successfully",
      data: {},
    });
  });

  it("resumes and responds with 200", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    vi.mocked(simulationService.resume).mockResolvedValue({} as never);

    await resumeSimulation(req, res, next);
    await flush();

    expect(simulationService.resume).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("cancels and responds with 200", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    vi.mocked(simulationService.cancel).mockResolvedValue({} as never);

    await cancelSimulation(req, res, next);
    await flush();

    expect(simulationService.cancel).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([
    ["pause", pauseSimulation],
    ["resume", resumeSimulation],
    ["cancel", cancelSimulation],
  ] as const)("%s requires authentication", async (_name, handler) => {
    const req = { params: { id: uuid } } as unknown as Request;
    const res = mockRes();
    const next = mockNext();

    await handler(req, res, next);
    await flush();

    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
  });
});

describe("saveSimulation", () => {
  it("saves the run for the caller and responds with 200", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const saved = { id: uuid, savedAt: "2026-01-01T00:00:00.000Z" };
    vi.mocked(simulationService.save).mockResolvedValue(saved as never);

    await saveSimulation(req, res, next);
    await flush();

    expect(simulationService.save).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Simulation saved successfully",
      data: saved,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid id", async () => {
    const req = mockAuthReq({ params: { id: "nope" } });
    const res = mockRes();
    const next = mockNext();

    await saveSimulation(req, res, next);
    await flush();

    expect(simulationService.save).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({
      statusCode: 400,
    });
  });

  it("requires authentication", async () => {
    const req = { params: { id: uuid } } as unknown as Request;
    const res = mockRes();
    const next = mockNext();

    await saveSimulation(req, res, next);
    await flush();

    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
  });
});

describe("deleteSimulation", () => {
  it("deletes the run for the caller and responds with 200", async () => {
    const req = mockAuthReq({ params: { id: uuid } });
    const res = mockRes();
    const next = mockNext();

    const deleted = { id: uuid, status: "completed" };
    vi.mocked(simulationService.remove).mockResolvedValue(deleted as never);

    await deleteSimulation(req, res, next);
    await flush();

    expect(simulationService.remove).toHaveBeenCalledWith(uuid, uuid);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "Simulation deleted successfully",
      data: deleted,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid id", async () => {
    const req = mockAuthReq({ params: { id: "nope" } });
    const res = mockRes();
    const next = mockNext();

    await deleteSimulation(req, res, next);
    await flush();

    expect(simulationService.remove).not.toHaveBeenCalled();
    expect((next as Mock).mock.calls[0]![0]).toMatchObject({
      statusCode: 400,
    });
  });

  it("requires authentication", async () => {
    const req = { params: { id: uuid } } as unknown as Request;
    const res = mockRes();
    const next = mockNext();

    await deleteSimulation(req, res, next);
    await flush();

    expect((next as Mock).mock.calls[0]![0]).toMatchObject({ statusCode: 401 });
  });
});
