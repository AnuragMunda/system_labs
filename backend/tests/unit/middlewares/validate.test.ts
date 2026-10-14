/**
 * @file validate.test.ts
 *
 * @description Unit tests for the validate middleware: it replaces `req.body`
 * with the Zod-parsed data on success and throws a BadRequestError on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../../../src/middlewares/validate.js";
import { ApiError } from "../../../src/lib/apiError.js";
import type { Request, Response, NextFunction } from "express";

const schema = z.object({
  name: z.string().min(1),
  email: z.email(),
  page: z.coerce.number().int().min(1).default(1),
});

function makeReq(body: unknown) {
  return { body } as Request;
}

function makeNext() {
  return vi.fn() as unknown as NextFunction;
}

const mockRes = (() => ({})) as unknown as Response;

describe("validate", () => {
  it("replaces req.body with the parsed data and calls next on a valid body", () => {
    const req = makeReq({ name: "Ada", email: "ada@test.local", page: "2" });
    const next = makeNext();

    validate(schema)(req, mockRes, next);

    expect(req.body).toEqual({
      name: "Ada",
      email: "ada@test.local",
      page: 2,
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it("assigns Zod defaults to omitted optional fields", () => {
    const req = makeReq({ name: "Ada", email: "ada@test.local" });
    const next = makeNext();

    validate(schema)(req, mockRes, next);

    expect(req.body).toEqual({
      name: "Ada",
      email: "ada@test.local",
      page: 1,
    });
  });

  it("throws a BadRequestError when the body is invalid", () => {
    const req = makeReq({ name: "", email: "not-an-email" });
    const next = makeNext();

    let thrown: unknown;
    try {
      validate(schema)(req, mockRes, next);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
      message: "Validation failed",
    });
    expect((thrown as ApiError).details).toEqual([
      expect.objectContaining({ path: "name" }),
      expect.objectContaining({ path: "email" }),
    ]);
    expect(next).not.toHaveBeenCalled();
  });
});
