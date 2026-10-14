/**
 * @file execution.test.ts
 *
 * @description Integration tests for asynchronous simulation execution and
 * startup recovery, exercised against the real database and execution manager.
 * Covers the atomic start claim under concurrency and reconciliation of runs
 * left in-flight by a previous process.
 */

import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";

import app from "../../../src/app.js";
import db from "../../../src/infrastructure/database/db.js";
import { simulationsTable } from "../../../src/infrastructure/database/schema/simulations.js";
import { resetDb, getTestDatabaseUrl } from "../helpers/db.js";
import {
  createProjectForUser,
  createUser,
  validArchitecture,
} from "../helpers/fixtures.js";
import {
  RECOVERY_REASON,
  recoverInterruptedSimulations,
} from "../../../src/jobs/simulation-recovery.js";
import { SimulationRepository } from "../../../src/modules/simulation/simulation.repository.js";

const describeDb = process.env.TEST_DB_UNAVAILABLE ? describe.skip : describe;

const repo = new SimulationRepository();

/** Creates a user, logs them in, and returns their id and access token. */
async function authenticatedUser() {
  const { user, password } = await createUser();
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password });

  return { id: user.id, accessToken: res.body.data.accessToken as string };
}

/** Creates an architecture owned by the given user and returns its id. */
async function createArchitecture(userId: string, token: string) {
  const project = await createProjectForUser(userId);
  const res = await request(app)
    .post("/api/v1/architectures")
    .set("Authorization", `Bearer ${token}`)
    .send(validArchitecture(project.id))
    .expect(201);

  return res.body.data.id as string;
}

/** Creates a simulation through the API and returns its id. */
async function createSimulation(architectureId: string, token: string) {
  const res = await request(app)
    .post("/api/v1/simulations")
    .set("Authorization", `Bearer ${token}`)
    .send({
      architectureId,
      sourceNodeId: "client-1",
      config: { durationMs: 1000, requestsPerSecond: 10 },
    })
    .expect(201);

  return res.body.data.id as string;
}

/** Inserts a simulation row directly in the given lifecycle status. */
async function seedSimulation(
  architectureId: string,
  status: "created" | "running" | "paused",
) {
  const [simulation] = await db
    .insert(simulationsTable)
    .values({ architectureId, status })
    .returning();

  return simulation!;
}

describeDb("Simulation execution & recovery", () => {
  beforeEach(async () => {
    await resetDb(getTestDatabaseUrl());
  });

  it("lets exactly one concurrent start claim a created simulation", async () => {
    const user = await authenticatedUser();
    const architectureId = await createArchitecture(user.id, user.accessToken);
    const simulationId = await createSimulation(
      architectureId,
      user.accessToken,
    );

    const start = () =>
      request(app)
        .post(`/api/v1/simulations/${simulationId}/start`)
        .set("Authorization", `Bearer ${user.accessToken}`);

    const [first, second] = await Promise.all([start(), start()]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([202, 409]);
  });

  it("reconciles running and paused runs to failed on startup", async () => {
    const user = await authenticatedUser();
    const architectureId = await createArchitecture(user.id, user.accessToken);

    const running = await seedSimulation(architectureId, "running");
    const paused = await seedSimulation(architectureId, "paused");
    const created = await seedSimulation(architectureId, "created");

    const reconciled = await recoverInterruptedSimulations();

    expect(reconciled.map((row) => row.id).sort()).toEqual(
      [running.id, paused.id].sort(),
    );

    const reconciledRunning = await repo.findById(running.id);
    expect(reconciledRunning.status).toBe("failed");
    expect(reconciledRunning.error).toBe(RECOVERY_REASON);
    expect(reconciledRunning.completedAt).toBeInstanceOf(Date);

    expect((await repo.findById(paused.id)).status).toBe("failed");
    expect((await repo.findById(created.id)).status).toBe("created");
  });

  it("reports no reconciliation when nothing was in flight", async () => {
    await expect(recoverInterruptedSimulations()).resolves.toEqual([]);
  });
});
