/**
 * @file simulation.api.test.ts
 *
 * @description Integration tests for the simulation HTTP endpoints, exercised
 * through supertest against the real app, database, and execution manager:
 * creation and ownership rules, asynchronous start (202 + polling to a terminal
 * status), persisted results, lifecycle conflicts, and reads that inherit the
 * parent project's visibility.
 */

import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";

import app from "../../../src/app.js";
import { resetDb, getTestDatabaseUrl } from "../helpers/db.js";
import {
  createProjectForUser,
  createUser,
  validArchitecture,
} from "../helpers/fixtures.js";
import { SimulationRepository } from "../../../src/modules/simulation/simulation.repository.js";

const describeDb = process.env.TEST_DB_UNAVAILABLE ? describe.skip : describe;

const repo = new SimulationRepository();

/** Identity and access token of the test's primary (logged-in) user. */
let ownerId = "";
let accessToken = "";

/**
 * Creates a user, logs them in, and returns their id plus an access token. The
 * first user created is also captured as the primary user for the test.
 */
async function createAuthenticatedUser() {
  const { user, password } = await createUser();
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password });

  const created = {
    id: user.id,
    accessToken: res.body.data.accessToken as string,
  };

  if (!ownerId) {
    ownerId = created.id;
    accessToken = created.accessToken;
  }

  return created;
}

/** The auth header attached to requests acting as the primary user. */
function authHeader() {
  return ["Authorization", `Bearer ${accessToken}`] as const;
}

/** Creates a project owned by the current primary user. */
async function createOwnerProject(overrides: object = {}) {
  return createProjectForUser(ownerId, overrides);
}

/** Creates an architecture through the API as the caller. */
function createArchitectureAs(
  token: string,
  projectId: string,
  overrides: object = {},
) {
  return request(app)
    .post("/api/v1/architectures")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...validArchitecture(projectId), ...overrides });
}

/** Creates a simulation through the API as the caller. */
function createSimulationAs(
  token: string,
  architectureId: string,
  overrides: object = {},
) {
  return request(app)
    .post("/api/v1/simulations")
    .set("Authorization", `Bearer ${token}`)
    .send({
      architectureId,
      sourceNodeId: "client-1",
      config: { durationMs: 1000, requestsPerSecond: 10 },
      ...overrides,
    });
}

/** Explicitly saves a simulation through the API as the caller. */
function saveSimulationAs(token: string, simulationId: string) {
  return request(app)
    .post(`/api/v1/simulations/${simulationId}/save`)
    .set("Authorization", `Bearer ${token}`)
    .expect(200);
}

/** Creates an owned architecture and returns its id and parent project. */
async function ownedArchitecture() {
  const project = await createOwnerProject();
  const created = await createArchitectureAs(accessToken, project.id).expect(
    201,
  );

  return { project, architectureId: created.body.data.id as string };
}

/** Creates an owned simulation and returns its response body data. */
async function ownedSimulation(overrides: object = {}) {
  const { project, architectureId } = await ownedArchitecture();
  const created = await createSimulationAs(
    accessToken,
    architectureId,
    overrides,
  ).expect(201);

  return { project, architectureId, simulation: created.body.data };
}

/**
 * Polls a simulation's status endpoint until it reaches a terminal state, since
 * start now schedules execution in the background and returns 202. Fails the
 * test if the run does not settle before the timeout.
 */
async function waitForTerminal(
  simulationId: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const res = await request(app)
      .get(`/api/v1/simulations/${simulationId}/status`)
      .set(...authHeader());

    const status = res.body.data?.status as string | undefined;

    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return res.body.data;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for simulation ${simulationId} (last status: ${status}).`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describeDb("Simulations API", () => {
  beforeEach(async () => {
    await resetDb(getTestDatabaseUrl());
    ownerId = "";
    accessToken = "";
    await createAuthenticatedUser();
  });

  describe("POST /api/v1/simulations", () => {
    it("creates a simulation for the caller's architecture and responds with 201", async () => {
      const { project, architectureId } = await ownedArchitecture();

      const res = await createSimulationAs(accessToken, architectureId);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Simulation created successfully");
      expect(res.body.data).toMatchObject({
        architectureId,
        status: "created",
        seed: 0,
        currentTimeMs: 0,
        savedAt: null,
      });
      expect(res.body.data.id).toEqual(expect.any(String));
      expect(res.body.data.createdAt).toBeDefined();
      // The persisted report must not leak through the create response.
      expect(res.body.data).not.toHaveProperty("result");

      const found = await repo.findById(res.body.data.id);
      expect(found.architectureId).toBe(architectureId);
      expect(found.status).toBe("created");
      expect(found.result).toBeNull();
      expect(project.id).toEqual(expect.any(String));
    });

    it("persists the seed supplied via config.randomSeed", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await createSimulationAs(accessToken, architectureId, {
        config: { durationMs: 1000, requestsPerSecond: 10, randomSeed: 7 },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.seed).toBe(7);

      const found = await repo.findById(res.body.data.id);
      expect(found.seed).toBe(7);
    });

    it("rejects creating a run for an architecture owned by someone else", async () => {
      const other = await createAuthenticatedUser();
      const otherProject = await createProjectForUser(other.id);
      const created = await createArchitectureAs(
        other.accessToken,
        otherProject.id,
      ).expect(201);

      const res = await createSimulationAs(accessToken, created.body.data.id);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ success: false, code: "FORBIDDEN" });
    });

    it("returns 404 when the architecture does not exist", async () => {
      const res = await createSimulationAs(
        accessToken,
        "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
      );

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("returns 400 when the source node is not in the snapshot", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await createSimulationAs(accessToken, architectureId, {
        sourceNodeId: "missing-node",
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    });

    it("returns 400 when a scheduled failure is not before the duration", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await createSimulationAs(accessToken, architectureId, {
        config: {
          durationMs: 1000,
          requestsPerSecond: 10,
          failures: [{ nodeId: "api-1", failedAtMs: 1500 }],
        },
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    });

    it("returns 400 when a scheduled failure references a node outside the snapshot", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await createSimulationAs(accessToken, architectureId, {
        config: {
          durationMs: 1000,
          requestsPerSecond: 10,
          failures: [{ nodeId: "missing-node", failedAtMs: 500 }],
        },
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        code: "BAD_REQUEST",
        message: "Failure node not found in architecture: missing-node",
      });
    });

    it("returns 400 with structured validation details when the config is incomplete", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await request(app)
        .post("/api/v1/simulations")
        .set(...authHeader())
        .send({
          architectureId,
          sourceNodeId: "client-1",
          config: { requestsPerSecond: 10 },
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        code: "BAD_REQUEST",
        message: "Validation failed",
      });
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "config.durationMs" }),
        ]),
      );
    });

    it("returns 400 when sourceNodeId is missing", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await request(app)
        .post("/api/v1/simulations")
        .set(...authHeader())
        .send({
          architectureId,
          config: { durationMs: 1000, requestsPerSecond: 10 },
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    });

    it("returns 401 without an access token", async () => {
      const { architectureId } = await ownedArchitecture();

      const res = await request(app)
        .post("/api/v1/simulations")
        .send({
          architectureId,
          sourceNodeId: "client-1",
          config: { durationMs: 1000, requestsPerSecond: 10 },
        });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    });
  });

  describe("POST /api/v1/simulations/:id/start", () => {
    it("accepts the run with 202, then completes in the background", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader());

      expect(res.status).toBe(202);
      expect(res.body.message).toBe("Simulation started successfully");
      expect(res.body.data.status).toBe("running");

      const status = await waitForTerminal(simulation.id);
      expect(status.status).toBe("completed");

      const found = await repo.findById(simulation.id);
      expect(found.status).toBe("completed");
      expect(found.completedAt).toBeInstanceOf(Date);
      expect(found.result).not.toBeNull();
      expect(found.result).toMatchObject({ simulationId: simulation.id });
    });

    it("exposes the persisted report through the results endpoint", async () => {
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.id);

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/results`)
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.simulation.status).toBe("completed");
      expect(res.body.data.metrics).toMatchObject({
        simulationId: simulation.id,
      });
    });

    it("reports completed through the status endpoint", async () => {
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/status`)
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: simulation.id,
      });
      expect(["running", "completed"]).toContain(res.body.data.status);

      const terminal = await waitForTerminal(simulation.id);
      expect(terminal.status).toBe("completed");
      expect(terminal.completedAt).toBeDefined();
    });

    it("exposes the persisted metrics report through the metrics endpoint", async () => {
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.id);

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/metrics`)
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ simulationId: simulation.id });
      expect(res.body.data.durationMs).toBe(1000);
    });

    it("returns 409 for metrics before the run has started", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/metrics`)
        .set(...authHeader());

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: "CONFLICT" });
    });

    it("returns 404 for metrics of an unknown run", async () => {
      const res = await request(app)
        .get("/api/v1/simulations/5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91/metrics")
        .set(...authHeader());

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("returns 409 when starting a simulation that already completed", async () => {
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.id);

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader());

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: "CONFLICT" });
    });

    it("rejects starting a run owned by someone else", async () => {
      const other = await createAuthenticatedUser();
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set("Authorization", `Bearer ${other.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ success: false, code: "FORBIDDEN" });
    });

    it("returns 400 for a non-uuid id", async () => {
      const res = await request(app)
        .post("/api/v1/simulations/not-a-uuid/start")
        .set(...authHeader());

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    });

    it("returns 404 for a valid uuid that does not exist", async () => {
      const res = await request(app)
        .post("/api/v1/simulations/5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91/start")
        .set(...authHeader());

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("returns 401 without an access token", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app).post(
        `/api/v1/simulations/${simulation.id}/start`,
      );

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    });
  });

  describe("POST /api/v1/simulations/:id lifecycle controls", () => {
    it("cancels a created simulation", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/cancel`)
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");

      const found = await repo.findById(simulation.id);
      expect(found.status).toBe("cancelled");
    });

    it("returns 409 when pausing a created simulation", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/pause`)
        .set(...authHeader());

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: "CONFLICT" });
    });

    it("returns 409 when resuming a created simulation", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/resume`)
        .set(...authHeader());

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: "CONFLICT" });
    });

    it("returns 409 when cancelling a completed simulation", async () => {
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.id);

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/cancel`)
        .set(...authHeader());

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, code: "CONFLICT" });
    });

    it("rejects lifecycle controls from a non-owner with a 403", async () => {
      const other = await createAuthenticatedUser();
      const { simulation } = await ownedSimulation();

      for (const action of ["pause", "resume", "cancel"]) {
        const res = await request(app)
          .post(`/api/v1/simulations/${simulation.id}/${action}`)
          .set("Authorization", `Bearer ${other.accessToken}`);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
          success: false,
          code: "FORBIDDEN",
        });
      }

      const found = await repo.findById(simulation.id);
      expect(found.status).toBe("created");
    });
  });

  describe("GET /api/v1/simulations/:id", () => {
    it("allows the owner to read a run in a PRIVATE project", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}`)
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: simulation.id,
        status: "created",
      });
      expect(res.body.data).not.toHaveProperty("result");
    });

    it("hides a run in a PRIVATE project from an anonymous caller", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app).get(
        `/api/v1/simulations/${simulation.id}`,
      );

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("hides a run in a PRIVATE project from another user", async () => {
      const other = await createAuthenticatedUser();
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}`)
        .set("Authorization", `Bearer ${other.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("allows an anonymous caller to read a run in a PUBLIC project", async () => {
      const project = await createOwnerProject({ visibility: "PUBLIC" });
      const created = await createArchitectureAs(
        accessToken,
        project.id,
      ).expect(201);
      const sim = await createSimulationAs(
        accessToken,
        created.body.data.id,
      ).expect(201);

      const res = await request(app).get(
        `/api/v1/simulations/${sim.body.data.id}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(sim.body.data.id);
    });

    it("returns 400 for a non-uuid id", async () => {
      const res = await request(app).get("/api/v1/simulations/not-a-uuid");

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    });

    it("returns 404 for a valid uuid that does not exist", async () => {
      const res = await request(app).get(
        "/api/v1/simulations/5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
      );

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });
  });

  describe("GET /api/v1/simulations/:id/results", () => {
    it("returns 404 before a run has produced a report", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/results`)
        .set(...authHeader());

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("hides results for a run in a PRIVATE project from another user", async () => {
      const other = await createAuthenticatedUser();
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.id);

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/results`)
        .set("Authorization", `Bearer ${other.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, code: "NOT_FOUND" });
    });

    it("allows an anonymous caller to read results for a completed run in a PUBLIC project", async () => {
      const project = await createOwnerProject({ visibility: "PUBLIC" });
      const architecture = await createArchitectureAs(
        accessToken,
        project.id,
      ).expect(201);
      const simulation = await createSimulationAs(
        accessToken,
        architecture.body.data.id,
      ).expect(201);

      await request(app)
        .post(`/api/v1/simulations/${simulation.body.data.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.body.data.id);

      const res = await request(app).get(
        `/api/v1/simulations/${simulation.body.data.id}/results`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.simulation.status).toBe("completed");
      expect(res.body.data.metrics).toMatchObject({
        simulationId: simulation.body.data.id,
      });
    });
  });

  describe("GET /api/v1/simulations", () => {
    it("returns only the caller's simulations, newest first, as lightweight summaries", async () => {
      const other = await createAuthenticatedUser();
      const otherProject = await createProjectForUser(other.id);
      const otherArchitecture = await createArchitectureAs(
        other.accessToken,
        otherProject.id,
      ).expect(201);
      const otherSimulation = await createSimulationAs(
        other.accessToken,
        otherArchitecture.body.data.id,
      ).expect(201);
      await saveSimulationAs(other.accessToken, otherSimulation.body.data.id);

      const { architectureId } = await ownedArchitecture();
      const first = await createSimulationAs(
        accessToken,
        architectureId,
      ).expect(201);
      await saveSimulationAs(accessToken, first.body.data.id);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const second = await createSimulationAs(
        accessToken,
        architectureId,
      ).expect(201);
      await saveSimulationAs(accessToken, second.body.data.id);

      const res = await request(app)
        .get("/api/v1/simulations")
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      expect(
        res.body.data.items.map((item: { id: string }) => item.id),
      ).toEqual([second.body.data.id, first.body.data.id]);

      for (const item of res.body.data.items) {
        expect(item).not.toHaveProperty("snapshot");
        expect(item).not.toHaveProperty("config");
        expect(item).not.toHaveProperty("result");
        expect(item).toMatchObject({
          architectureId,
          status: "created",
          seed: 0,
          currentTimeMs: 0,
          durationMs: 1000,
          startedAt: null,
          completedAt: null,
          error: null,
          savedAt: expect.any(String),
        });
        expect(typeof item.createdAt).toBe("string");
      }
    });

    it("filters by architectureId and projectId", async () => {
      const { project, architectureId } = await ownedArchitecture();
      const first = await createSimulationAs(
        accessToken,
        architectureId,
      ).expect(201);
      await saveSimulationAs(accessToken, first.body.data.id);
      const second = await createSimulationAs(
        accessToken,
        architectureId,
      ).expect(201);
      await saveSimulationAs(accessToken, second.body.data.id);

      const otherArchitecture = await createArchitectureAs(
        accessToken,
        project.id,
        { name: "Secondary" },
      ).expect(201);
      const third = await createSimulationAs(
        accessToken,
        otherArchitecture.body.data.id,
      ).expect(201);
      await saveSimulationAs(accessToken, third.body.data.id);

      const byArchitecture = await request(app)
        .get(`/api/v1/simulations?architectureId=${architectureId}`)
        .set(...authHeader());
      expect(byArchitecture.status).toBe(200);
      expect(byArchitecture.body.data.pagination.total).toBe(2);
      for (const item of byArchitecture.body.data.items) {
        expect(item.architectureId).toBe(architectureId);
      }

      const byProject = await request(app)
        .get(`/api/v1/simulations?projectId=${project.id}`)
        .set(...authHeader());
      expect(byProject.status).toBe(200);
      expect(byProject.body.data.pagination.total).toBe(3);
    });

    it("paginates with page and limit", async () => {
      const { architectureId } = await ownedArchitecture();
      for (let i = 0; i < 3; i += 1) {
        const created = await createSimulationAs(
          accessToken,
          architectureId,
        ).expect(201);
        await saveSimulationAs(accessToken, created.body.data.id);
      }

      const res = await request(app)
        .get("/api/v1/simulations?page=2&limit=2")
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(res.body.data.items).toHaveLength(1);
    });

    it("returns 400 for an invalid query", async () => {
      const res = await request(app)
        .get("/api/v1/simulations?architectureId=not-a-uuid")
        .set(...authHeader());

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    });

    it("returns 401 without an access token", async () => {
      const res = await request(app).get("/api/v1/simulations");

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    });
  });

  describe("saved draft lifecycle", () => {
    it("lists saved runs by default and drafts with saved=false", async () => {
      const { architectureId } = await ownedArchitecture();
      const saved = await createSimulationAs(
        accessToken,
        architectureId,
      ).expect(201);
      const draft = await createSimulationAs(
        accessToken,
        architectureId,
      ).expect(201);

      await saveSimulationAs(accessToken, saved.body.data.id);

      const savedList = await request(app)
        .get("/api/v1/simulations")
        .set(...authHeader());
      expect(savedList.status).toBe(200);
      expect(savedList.body.data.pagination.total).toBe(1);
      expect(savedList.body.data.items[0].id).toBe(saved.body.data.id);
      expect(savedList.body.data.items[0].savedAt).toEqual(expect.any(String));

      const draftList = await request(app)
        .get("/api/v1/simulations?saved=false")
        .set(...authHeader());
      expect(draftList.status).toBe(200);
      expect(draftList.body.data.pagination.total).toBe(1);
      expect(draftList.body.data.items[0].id).toBe(draft.body.data.id);
      expect(draftList.body.data.items[0].savedAt).toBeNull();
    });

    it("saves a draft and keeps the original timestamp on repeat", async () => {
      const { simulation } = await ownedSimulation();

      const first = await saveSimulationAs(accessToken, simulation.id);
      expect(first.body.data.savedAt).toEqual(expect.any(String));

      await new Promise((resolve) => setTimeout(resolve, 15));
      const second = await saveSimulationAs(accessToken, simulation.id);

      expect(second.body.data.savedAt).toBe(first.body.data.savedAt);
    });

    it("rejects saving a run owned by someone else with a 403", async () => {
      const other = await createAuthenticatedUser();
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .post(`/api/v1/simulations/${simulation.id}/save`)
        .set("Authorization", `Bearer ${other.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ success: false, code: "FORBIDDEN" });
    });

    it("returns 404 when saving an unknown run", async () => {
      const res = await request(app)
        .post("/api/v1/simulations/5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91/save")
        .set(...authHeader());

      expect(res.status).toBe(404);
    });

    it("requires authentication to save", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app).post(
        `/api/v1/simulations/${simulation.id}/save`,
      );

      expect(res.status).toBe(401);
    });

    it("deletes an owned run and makes it unreadable", async () => {
      const { simulation } = await ownedSimulation();
      await saveSimulationAs(accessToken, simulation.id);

      const deleted = await request(app)
        .delete(`/api/v1/simulations/${simulation.id}`)
        .set(...authHeader());

      expect(deleted.status).toBe(200);
      expect(deleted.body.data).toMatchObject({ id: simulation.id });

      const read = await request(app)
        .get(`/api/v1/simulations/${simulation.id}`)
        .set(...authHeader());
      expect(read.status).toBe(404);
    });

    it("rejects deleting a run owned by someone else with a 403", async () => {
      const other = await createAuthenticatedUser();
      const { simulation } = await ownedSimulation();

      const res = await request(app)
        .delete(`/api/v1/simulations/${simulation.id}`)
        .set("Authorization", `Bearer ${other.accessToken}`);

      expect(res.status).toBe(403);
    });

    it("returns 400 for a non-uuid id on delete", async () => {
      const res = await request(app)
        .delete("/api/v1/simulations/not-a-uuid")
        .set(...authHeader());

      expect(res.status).toBe(400);
    });

    it("requires authentication to delete", async () => {
      const { simulation } = await ownedSimulation();

      const res = await request(app).delete(
        `/api/v1/simulations/${simulation.id}`,
      );

      expect(res.status).toBe(401);
    });
  });

  describe("response contract", () => {
    it("exposes durationMs and ISO date strings on the status view", async () => {
      const { simulation } = await ownedSimulation();

      await request(app)
        .post(`/api/v1/simulations/${simulation.id}/start`)
        .set(...authHeader())
        .expect(202);

      await waitForTerminal(simulation.id);

      const res = await request(app)
        .get(`/api/v1/simulations/${simulation.id}/status`)
        .set(...authHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: simulation.id,
        status: "completed",
        durationMs: 1000,
      });
      expect(res.body.data.currentTimeMs).toEqual(expect.any(Number));
      expect(res.body.data.startedAt).toEqual(expect.any(String));
      expect(res.body.data.completedAt).toEqual(expect.any(String));
    });
  });
});
