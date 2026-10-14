/**
 * @file app.test.ts
 *
 * @description Integration tests for the app's default routes (welcome,
 * health) and unmatched-route behavior.
 */

import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../../src/app.js";

const describeDb = process.env.TEST_DB_UNAVAILABLE ? describe.skip : describe;

describeDb("app", () => {
  it("GET / responds with the welcome message", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Welcome to the System Lab API!" });
  });

  it("GET /health responds OK", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "OK", message: "Server is healthy." });
  });

  it("returns a JSON 404 for an unknown route", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({
      success: false,
      message: "Resource not found",
      code: "NOT_FOUND",
    });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await request(app)
      .post("/api/v1/simulations")
      .set("Content-Type", "application/json")
      .send('{"architectureId":');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Malformed JSON in request body",
      code: "BAD_REQUEST",
    });
  });
});
