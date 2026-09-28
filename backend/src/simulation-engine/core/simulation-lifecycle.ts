/**
 * @file simulation-lifecycle.ts
 *
 * @description Declares the simulation lifecycle state machine: which status
 * transitions each lifecycle action may perform. Every status mutation in the
 * engine and session flows through this module so that invalid transitions are
 * rejected in one place instead of being silently applied.
 */

import {
  Simulation,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";

/** A lifecycle operation that validates and/or mutates the simulation status. */
export type LifecycleAction =
  | "prepare"
  | "start"
  | "step"
  | "pause"
  | "resume"
  | "cancel"
  | "complete"
  | "fail";

/** The status each action may be invoked from, mirroring the transition matrix. */
const ALLOWED_FROM: Record<LifecycleAction, readonly SimulationStatus[]> = {
  // Setup requires a still-created simulation and does not change the status.
  prepare: ["created"],
  // Execution starts only from a created simulation.
  start: ["created"],
  // Step processes a single event while running.
  step: ["running"],
  pause: ["running"],
  resume: ["paused"],
  // A simulation may be cancelled before it starts, while running, or while
  // paused; terminal states are permanent.
  cancel: ["created", "running", "paused"],
  // Internal: exhaustion of the event queue while running.
  complete: ["running"],
  // Internal: a processing failure while the simulation is not yet terminal.
  fail: ["created", "running", "paused"],
};

/** The status an action resolves to, or `undefined` when the action does not move status. */
const TARGET_STATUS: Record<LifecycleAction, SimulationStatus | undefined> = {
  prepare: undefined,
  start: "running",
  step: undefined,
  pause: "paused",
  resume: "running",
  cancel: "cancelled",
  complete: "completed",
  fail: "failed",
};

/** The past participle used in rejection messages, per action. */
const VERB: Record<LifecycleAction, string> = {
  prepare: "prepared",
  start: "started",
  step: "stepped",
  pause: "paused",
  resume: "resumed",
  cancel: "cancelled",
  complete: "completed",
  fail: "failed",
};

/**
 * Throws when the given action is not permitted from the simulation's current
 * status.
 */
export function assertSimulationTransitionAllowed(
  simulation: Simulation,
  action: LifecycleAction,
): void {
  const status = simulation.status;

  if (!ALLOWED_FROM[action].includes(status)) {
    throw new Error(
      `Simulation cannot be ${VERB[action]} from status ${status}`,
    );
  }
}

/**
 * Validates the action against the simulation's current status and, when it
 * resolves to a new status, applies the transition and its lifecycle timestamps.
 */
export function transitionSimulationStatus(
  simulation: Simulation,
  action: LifecycleAction,
): void {
  assertSimulationTransitionAllowed(simulation, action);

  const target = TARGET_STATUS[action];

  if (target !== undefined) {
    simulation.status = target;
  }

  if (action === "start") {
    simulation.startedAt = new Date();
  }

  if (action === "cancel" || action === "complete" || action === "fail") {
    simulation.completedAt = new Date();
  }
}

/** Returns the statuses an action may be invoked from, for declarative tests. */
export function allowedFromStatuses(
  action: LifecycleAction,
): readonly SimulationStatus[] {
  return ALLOWED_FROM[action];
}
