/**
 * @file errorMiddleware.ts
 *
 * @description Global error handler registered last in the Express pipeline.
 * Converts any thrown error into a JSON response. ApiErrors keep their status
 * code and code; anything else becomes a 500. Stack traces are only included
 * in development.
 */

import type { Request, Response, NextFunction } from "express";
import { HttpStatus, ApiMessages } from "@/config/constants/index.js";
import { ApiError } from "@/lib/index.js";
import { logger } from "@/lib/logger.js";

export const errorMiddleware = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let message = ApiMessages.SERVER_ERROR.INTERNAL_ERROR;
  let code: string | undefined;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
  }

  // Expected client errors (4xx) are logged as warnings; anything else is a
  // server-side failure and logged with the full error for debugging.
  if (err instanceof ApiError && statusCode < 500) {
    logger.warn({ statusCode, code, msg: message }, "Handled API error");
  } else {
    logger.error(err, "Unhandled error");
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    stack:
      process.env.NODE_ENV === "development"
        ? err instanceof Error
          ? err.stack
          : String(err)
        : undefined,
  });
};
