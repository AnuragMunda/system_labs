/**
 * @file errorMiddleware.ts
 *
 * @description Global error handler registered last in the Express pipeline.
 * Converts any thrown error into a JSON response. ApiErrors keep their status
 * code, code, and details; body-parser failures (malformed JSON, oversized
 * payloads) are mapped to their client-error statuses; anything else becomes a
 * 500. Stack traces are only included in development.
 */

import type { Request, Response, NextFunction } from "express";
import { HttpStatus, ApiMessages } from "@/config/constants/index.js";
import { ApiError } from "@/lib/index.js";
import { logger } from "@/lib/logger.js";

/** Narrows an unknown error to a body-parser error carrying a `type` marker. */
const isBodyParserError = (err: unknown): err is { type: string } =>
  typeof err === "object" && err !== null && "type" in err;

export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let message: string = ApiMessages.SERVER_ERROR.INTERNAL_ERROR;
  let code: string | undefined;
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (isBodyParserError(err)) {
    if (err.type === "entity.parse.failed") {
      statusCode = HttpStatus.BAD_REQUEST;
      message = ApiMessages.CLIENT_ERROR.MALFORMED_JSON;
      code = "BAD_REQUEST";
    } else if (err.type === "entity.too.large") {
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      message = ApiMessages.CLIENT_ERROR.PAYLOAD_TOO_LARGE;
      code = "PAYLOAD_TOO_LARGE";
    }
  }

  // Expected client errors (4xx) are logged as warnings; anything else is a
  // server-side failure and logged with the full error for debugging.
  if (statusCode < 500) {
    logger.warn({ statusCode, code, msg: message }, "Handled API error");
  } else {
    logger.error(err, "Unhandled error");
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(details !== undefined && { details }),
    stack:
      process.env.NODE_ENV === "development"
        ? err instanceof Error
          ? err.stack
          : String(err)
        : undefined,
  });
};
