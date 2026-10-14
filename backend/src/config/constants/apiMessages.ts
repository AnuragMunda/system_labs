/**
 * @file apiMessages.ts
 *
 * @description Centralized API response and error message strings grouped by
 * outcome (success, client error, server error). Using these constants keeps
 * messages consistent across the API and avoids magic strings.
 */

export const ApiMessages = Object.freeze({
  /** Messages for successful responses. */
  SUCCESS: {
    OK: "Request successful",
    CREATED: "Resource created successfully",
    UPDATED: "Resource updated successfully",
    DELETED: "Resource deleted successfully",
    FETCHED: "Resource fetched successfully",
  },

  /** Messages for client-side request errors (e.g. invalid or missing data). */
  CLIENT_ERROR: {
    BAD_REQUEST: "Invalid request data",
    UNAUTHORIZED: "Authentication required",
    FORBIDDEN: "You do not have permission to access this resource",
    NOT_FOUND: "Resource not found",
    CONFLICT: "Resource already exists",
    VALIDATION_FAILED: "Validation failed",
    MALFORMED_JSON: "Malformed JSON in request body",
    PAYLOAD_TOO_LARGE: "Request payload is too large",
  },

  /** Messages for server-side failures. */
  SERVER_ERROR: {
    INTERNAL_ERROR: "Something went wrong on the server",
    NOT_IMPLEMENTED: "Feature not implemented",
    SERVICE_UNAVAILABLE: "Service temporarily unavailable",
    DATABASE_ERROR: "Database operation failed",
  },
});
