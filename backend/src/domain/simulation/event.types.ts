/**
 * @file event.types.ts
 *
 * @description Domain types describing the discrete events a simulation emits
 * as it processes requests through an architecture. Events are recorded for
 * replay and visualization of how the system behaved over time.
 */

/** The set of events a simulation can emit as it processes requests. */
export type SimulationEventType =
  | "request.created"
  | "request.routed"
  | "request.processing_started"
  | "request.processing_completed"
  | "request.completed"
  | "request.failed"
  | "request.retry"
  | "cache.hit"
  | "cache.miss"
  | "database.request"
  | "queue.enqueue"
  | "queue.dequeue"
  | "worker.started"
  | "worker.completed"
  | "component.failed"
  | "component.recovered";

/** A single timestamped event produced while running a simulation. */
export interface SimulationEvent {
  id: string;
  simulationId: string;

  timestampMs: number;

  type: SimulationEventType;

  sourceNodeId?: string;
  targetNodeId?: string;

  payload?: Record<string, unknown>; // Additional data related to the event
}
