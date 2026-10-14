/**
 * @file apiError.ts
 *
 * @description Defines the ApiError class and factory helpers for creating
 * standardized HTTP errors. Errors carry a status code and machine-readable
 * code so the global error middleware can produce consistent responses.
 */

import { ApiMessages, HttpStatus } from "@/config/constants/index.js";

class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly isOperational?: boolean; // Indicates if the error is operational (expected) or a programming error (unexpected)
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    code: string,
    details?: unknown,
  ) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 error for invalid request data. The first argument, when supplied, becomes
 * the response message (callers pass the specific reason); optional `details`
 * carries machine-readable validation issues.
 */
export const BadRequestError = (
  message: string = ApiMessages.CLIENT_ERROR.BAD_REQUEST,
  details?: unknown,
) => new ApiError(message, HttpStatus.BAD_REQUEST, "BAD_REQUEST", details);

/** 401 error for missing or invalid authentication. */
export const UnauthorizedError = (
  message: string = ApiMessages.CLIENT_ERROR.UNAUTHORIZED,
) => new ApiError(message, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");

/** 403 error when the user is not allowed to access the resource. */
export const ForbiddenError = () =>
  new ApiError(
    ApiMessages.CLIENT_ERROR.FORBIDDEN,
    HttpStatus.FORBIDDEN,
    "FORBIDDEN",
  );

/** 404 error when the requested resource does not exist. */
export const NotFoundError = () =>
  new ApiError(
    ApiMessages.CLIENT_ERROR.NOT_FOUND,
    HttpStatus.NOT_FOUND,
    "NOT_FOUND",
  );

/** 409 error when a resource conflicts with existing data (e.g. unique constraint). */
export const ConflictError = (
  message: string = ApiMessages.CLIENT_ERROR.CONFLICT,
) => new ApiError(message, HttpStatus.CONFLICT, "CONFLICT");

/** 500 error for unexpected server failures. Accepts an optional custom message. */
export const InternalServerError = (
  message: string = ApiMessages.SERVER_ERROR.INTERNAL_ERROR,
) => new ApiError(message, HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR");

export { ApiError };
