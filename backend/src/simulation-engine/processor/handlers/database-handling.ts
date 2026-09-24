/**
 * @file database-handling.ts
 *
 * @description Handlers for the database events emitted after a request is
 * routed to a database component: `database.request` and `database.response`.
 *
 * A `database.request` sends a request into the database's normal
 * capacity-bound processing path (health, capacity, queueing, latency, error
 * handling). When that processing completes, a `database.response` carries the
 * operation's result into normal request routing.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import type { DatabaseOperation } from "@/domain/simulation/request.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import { createEvent } from "../../utils/helpers.js";
import { getRequestId } from "./event-handling.js";
import { RequestLifecycleHandlers } from "./request-lifecycle.js";

const VALID_OPERATIONS: ReadonlySet<string> = new Set(["read", "write"]);

/** Handlers for the `database.*` event types. */
export class DatabaseHandlers {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly requestHandlers: RequestLifecycleHandlers,
  ) {}

  /**
   * Sends a request routed to a database node into its capacity-bound
   * processing path.
   *
   * The operation is resolved as:
   * - the operation stamped on the request at creation, when present;
   * - `"read"` when the request carries no operation;
   * - an error when an unknown operation is present, since it indicates a
   *   mismatch between the traffic configuration and the runtime's supported
   *   operations.
   */
  handleDatabaseRequest(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error("database.request event requires a sourceNodeId.");
    }

    if (!this.runtime.isDatabaseNode(event.sourceNodeId)) {
      throw new Error(
        `database.request event routed to a non-database node: ${event.sourceNodeId}.`,
      );
    }

    const requested = this.runtime.getRequest(requestId).databaseOperation;

    const operation: DatabaseOperation = requested ?? "read";

    if (!VALID_OPERATIONS.has(operation)) {
      throw new Error(
        `Unknown database operation "${operation}" for request ${requestId}.`,
      );
    }

    this.runtime.updateRequest(requestId, { databaseOperation: operation });

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.processing_started",
        sourceNodeId: event.sourceNodeId,
        targetNodeId: event.sourceNodeId,
        payload: {
          requestId,
          databaseOperation: operation,
        },
      }),
    );
  }

  /**
   * Routes the result of a completed database operation into normal request
   * routing: a terminal database completes the request; a database with
   * outgoing connections forwards it downstream.
   */
  handleDatabaseResponse(event: SimulationEvent): void {
    if (!event.sourceNodeId) {
      throw new Error("database.response event requires a sourceNodeId.");
    }

    if (!this.runtime.isDatabaseNode(event.sourceNodeId)) {
      throw new Error(
        `database.response event routed to a non-database node: ${event.sourceNodeId}.`,
      );
    }

    this.requestHandlers.routeRequest(event, event.sourceNodeId);
  }
}
