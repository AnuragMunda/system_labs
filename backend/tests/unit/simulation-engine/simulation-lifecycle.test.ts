/**
 * @file simulation-lifecycle.test.ts
 *
 * @description Declares and validates the full simulation lifecycle transition
 * matrix: for every lifecycle action and every status, which transitions are
 * allowed and which are rejected. This is the authoritative record of the
 * valid/invalid decision for each transition.
 */

import { describe, expect, it } from "vitest";
import {
  LifecycleAction,
  allowedFromStatuses,
  assertSimulationTransitionAllowed,
  transitionSimulationStatus,
} from "@/simulation-engine/core/simulation-lifecycle.js";
import {
  Simulation,
  SimulationStatus,
} from "@/domain/simulation/simulation.types.js";

const STATUSES: readonly SimulationStatus[] = [
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

const ACTIONS: readonly LifecycleAction[] = [
  "prepare",
  "start",
  "step",
  "pause",
  "resume",
  "cancel",
  "complete",
  "fail",
];

/** The status each action resolves to, when the transition is allowed. */
const EXPECTED_AFTER: Partial<Record<LifecycleAction, SimulationStatus>> = {
  start: "running",
  pause: "paused",
  resume: "running",
  cancel: "cancelled",
  complete: "completed",
  fail: "failed",
};

const REJECTION_VERB: Record<LifecycleAction, string> = {
  prepare: "prepared",
  start: "started",
  step: "stepped",
  pause: "paused",
  resume: "resumed",
  cancel: "cancelled",
  complete: "completed",
  fail: "failed",
};

function createSimulation(status: SimulationStatus): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status,
    config: {
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: false,
      emitEvents: false,
    },
    currentTimeMs: 0,
    seed: 42,
    architectureSnapshot: { nodes: [], edges: [] },
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("SimulationLifecycle", () => {
  it("rejects every transition that is not in the allowed-from table", () => {
    for (const action of ACTIONS) {
      for (const status of STATUSES) {
        const simulation = createSimulation(status);
        const allowed = allowedFromStatuses(action).includes(status);

        if (allowed) {
          expect(
            () => assertSimulationTransitionAllowed(simulation, action),
            `${action} should be allowed from ${status}`,
          ).not.toThrow();
        } else {
          expect(
            () => assertSimulationTransitionAllowed(simulation, action),
            `${action} should be rejected from ${status}`,
          ).toThrow(
            `Simulation cannot be ${REJECTION_VERB[action]} from status ${status}`,
          );
        }
      }
    }
  });

  it("applies the target status only for allowed transitions", () => {
    for (const action of ACTIONS) {
      for (const status of STATUSES) {
        const simulation = createSimulation(status);
        const allowed = allowedFromStatuses(action).includes(status);
        const target = EXPECTED_AFTER[action];

        if (!allowed) {
          expect(() =>
            transitionSimulationStatus(simulation, action),
          ).toThrow();
          continue;
        }

        transitionSimulationStatus(simulation, action);

        expect(
          simulation.status,
          `${action} from ${status} should end at ${target ?? status}`,
        ).toBe(target ?? status);
      }
    }
  });

  it("records startedAt when starting a created simulation", () => {
    const simulation = createSimulation("created");

    transitionSimulationStatus(simulation, "start");

    expect(simulation.startedAt).toBeInstanceOf(Date);
  });

  it("records completedAt for cancel, complete, and fail", () => {
    for (const action of ["cancel", "complete", "fail"] as const) {
      const from =
        action === "cancel"
          ? "running"
          : action === "complete"
            ? "running"
            : "running";
      const simulation = createSimulation(from);

      transitionSimulationStatus(simulation, action);

      expect(simulation.completedAt).toBeDefined();
    }
  });

  it("keeps the simulation in place for prepare and step", () => {
    const prepareSimulation = createSimulation("created");
    transitionSimulationStatus(prepareSimulation, "prepare");
    expect(prepareSimulation.status).toBe("created");

    const stepSimulation = createSimulation("running");
    transitionSimulationStatus(stepSimulation, "step");
    expect(stepSimulation.status).toBe("running");
  });
});
