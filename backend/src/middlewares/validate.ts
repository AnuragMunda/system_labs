/**
 * @file validate.ts
 *
 * @description Express middleware factory that validates a request body against
 * a Zod schema, replacing `req.body` with the parsed data or forwarding a
 * BadRequestError. The thrown error carries a summary message plus the
 * structured Zod issues so clients can see exactly which fields failed.
 */

import { ApiMessages } from "@/config/constants/index.js";
import { BadRequestError } from "@/lib/apiError.js";
import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export const validate = (schema: ZodType): RequestHandler => {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      throw BadRequestError(
        ApiMessages.CLIENT_ERROR.VALIDATION_FAILED,
        details,
      );
    }

    req.body = result.data;

    next();
  };
};
