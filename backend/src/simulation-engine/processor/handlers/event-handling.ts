/**
 * @file event-handling.ts
 *
 * @description Small helpers shared by the event processor's handler modules:
 * extracting the request id from an event payload and making a component health
 * transition observable in the event stream.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";

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
