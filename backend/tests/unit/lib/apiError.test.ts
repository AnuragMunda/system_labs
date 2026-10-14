/**
 * @file apiError.test.ts
 *
 * @description Unit tests for the ApiError class and its factory helpers,
 * verifying status codes, machine-readable codes, and error metadata.
 */

import { describe, it, expect } from "vitest";
import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
} from "../../../src/lib/index.js";

describe("ApiError", () => {
  it("creates an operational error by default", () => {
    const error = new ApiError("boom", 500, "BOOM");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe("BOOM");
    expect(error.isOperational).toBe(true);
  });

  it("defaults statusCode to 500", () => {
    const error = new ApiError("boom", 500, "BOOM");
    expect(error.statusCode).toBe(500);
  });

  it("carries optional details", () => {
    const error = new ApiError("boom", 500, "BOOM", { field: "name" });
    expect(error.details).toEqual({ field: "name" });
  });

  it("captures a stack trace", () => {
    const error = new ApiError("boom", 500, "BOOM");
    expect(typeof error.stack).toBe("string");
  });
});

describe("error factories", () => {
  it.each([
    [
      "BadRequestError",
      BadRequestError,
      400,
      "BAD_REQUEST",
      "Invalid request data",
    ],
    [
      "UnauthorizedError",
      UnauthorizedError,
      401,
      "UNAUTHORIZED",
      "Authentication required",
    ],
    [
      "ForbiddenError",
      ForbiddenError,
      403,
      "FORBIDDEN",
      "You do not have permission to access this resource",
    ],
    ["NotFoundError", NotFoundError, 404, "NOT_FOUND", "Resource not found"],
    [
      "ConflictError",
      ConflictError,
      409,
      "CONFLICT",
      "Resource already exists",
    ],
  ])("%s returns a %i error with code %s", (_name, factory, status, code) => {
    const error = factory();

    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(status);
    expect(error.code).toBe(code);
    expect(error.isOperational).toBe(true);
  });

  it("BadRequestError passes details through", () => {
    const details = { issue: "missing name" };
    expect(BadRequestError("Invalid body", details).details).toEqual(details);
  });

  it("BadRequestError uses the supplied message", () => {
    expect(BadRequestError("No fields provided.").message).toBe(
      "No fields provided.",
    );
  });

  it("BadRequestError defaults to the generic message", () => {
    expect(BadRequestError().message).toBe("Invalid request data");
  });

  it("InternalServerError uses a default message", () => {
    const error = InternalServerError();
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toBe("Something went wrong on the server");
  });

  it("InternalServerError accepts a custom message", () => {
    const error = InternalServerError("Custom failure");
    expect(error.message).toBe("Custom failure");
  });
});
