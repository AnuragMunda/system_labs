/**
 * @file errorMiddleware.test.ts
 *
 * @description Unit tests for the global error middleware: it maps ApiErrors to
 * their status/code/details, body-parser failures to client-error statuses, and
 * everything else to a generic 500, always responding with the error envelope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import { errorMiddleware } from "../../../src/middlewares/errorMiddleware.js";
import {
  BadRequestError,
  InternalServerError,
} from "../../../src/lib/apiError.js";
import { logger } from "../../../src/lib/logger.js";

/** Creates a minimal fake Express response with mocked status/json. */
function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const req = {} as Request;
const next = vi.fn() as unknown as NextFunction;

beforeEach(() => {
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
});

describe("errorMiddleware", () => {
  it("maps an ApiError to its status, code, and details", () => {
    const res = mockRes();
    const details = [{ path: "email", message: "Invalid email" }];

    errorMiddleware(
      BadRequestError("Validation failed", details),
      req,
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Validation failed",
        code: "BAD_REQUEST",
        details,
      }),
    );
  });

  it("omits details when an ApiError has none", () => {
    const res = mockRes();

    errorMiddleware(InternalServerError(), req, res, next);

    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0];

    expect(res.status).toHaveBeenCalledWith(500);
    expect(body).not.toHaveProperty("details");
  });

  it("turns an unknown error into a generic 500", () => {
    const res = mockRes();

    errorMiddleware(new Error("boom"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Something went wrong on the server",
      }),
    );
  });

  it("maps a malformed JSON body to 400", () => {
    const res = mockRes();
    const err = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
    });

    errorMiddleware(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Malformed JSON in request body",
        code: "BAD_REQUEST",
      }),
    );
  });

  it("maps an oversized payload to 413", () => {
    const res = mockRes();
    const err = Object.assign(new Error("request entity too large"), {
      type: "entity.too.large",
      status: 413,
    });

    errorMiddleware(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Request payload is too large",
        code: "PAYLOAD_TOO_LARGE",
      }),
    );
  });

  it("ignores typed errors that are not known body-parser failures", () => {
    const res = mockRes();
    const err = Object.assign(new Error("nope"), { type: "unknown.type" });

    errorMiddleware(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
