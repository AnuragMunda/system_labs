/**
 * @file event-handling.ts
 *
 * @description Small helpers shared by the event processor's handler modules:
 * extracting the request id from an event payload and making a component health
 * transition observable in the event stream.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import type { SimulationRequest } from "@/domain/simulation/request.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import { ComponentRuntimeState } from "../../utils/types.js";
import { createEvent } from "../../utils/helpers.js";

/** Extracts the requestId payload of an event, throwing when it is missing. */
export function getRequestId(event: SimulationEvent): string {
  const requestId = event.payload?.requestId;

  if (typeof requestId !== "string") {
    throw new Error(`${event.type} event requires a requestId.`);
  }

  return requestId;
}

/**
 * Enforces that a request's terminal state is sticky. Once a request is
 * `completed` or `failed`, no later event may resurrect it or record anything
 * against it: producers are exclusive by construction, so a violation here
 * indicates a producer bug — failing loudly beats silently corrupting
 * metrics, capacity, queue membership, or circuit-probe state.
 */
export function assertRequestNotTerminal(
  request: SimulationRequest,
  event: SimulationEvent,
): void {
  if (request.status === "completed" || request.status === "failed") {
    throw new Error(
      `${event.type} cannot follow a terminal state: request ${request.id} is already ${request.status}.`,
    );
  }
}

/**
 * Enforces that a queued request cannot be finalized before it has been
 * dequeued and started. `request.processing_completed` and
 * `request.completed` imply the request actually executed, and the only way
 * out of a queue is `queue.drain` → `request.processing_started` →
 * `in-flight` — so a violation indicates a producer bug.
 */
export function assertRequestNotQueued(
  request: SimulationRequest,
  event: SimulationEvent,
): void {
  if (request.status === "queued") {
    throw new Error(
      `${event.type} cannot run for a queued request: request ${request.id} has not started processing.`,
    );
  }
}

/**
 * Schedules the component.health_changed event that makes a health transition
 * observable in the event stream.
 */
export function scheduleHealthChanged(
  runtime: SimulationRuntime,
  event: SimulationEvent,
  nodeId: string,
  previousHealth: ComponentRuntimeState["health"],
  health: ComponentRuntimeState["health"],
): void {
  runtime.schedule(
    createEvent({
      simulationId: event.simulationId,
      timestampMs: event.timestampMs,
      type: "component.health_changed",
      sourceNodeId: nodeId,
      payload: {
        previousHealth,
        health,
      },
    }),
  );
}
