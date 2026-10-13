/**
 * @file simulation.orchestrator.test.ts
 *
 * @description Unit tests for SimulationOrchestrator. The engine stack is used
 * for real (no mocks), so these tests exercise orchestration end to end without
 * touching the database: run creation, isolated runtime state, deterministic
 * execution, lifecycle control, and the plain read interfaces.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { SimulationOrchestrator } from "../../../../src/modules/simulation/simulation.orchestrator.js";
import type { CreateSimulationInput } from "../../../../src/modules/simulation/simulation.orchestrator.types.js";
import type { ArchitectureGraph } from "../../../../src/domain/architecture/architecture.types.js";
import type { ArchitectureNode } from "../../../../src/domain/architecture/component.types.js";

/** Builds a graph node with a zeroed position. */
function node(
  id: string,
  type: ArchitectureNode["type"],
  config: ArchitectureNode["config"] = {},
): ArchitectureNode {
  return { id, type, name: id, position: { x: 0, y: 0 }, config };
}

/** Builds a directed edge identified by its endpoints. */
function edge(
  source: string,
  target: string,
  config: ArchitectureGraph["edges"][number]["config"] = {},
): ArchitectureGraph["edges"][number] {
  return { id: `${source}-${target}`, source, target, config };
}

/** A healthy client → api → database pipeline. */
const pipeline: ArchitectureGraph = {
  nodes: [
    node("client", "load_balancer"),
    node("api", "api", { concurrency: 100, latencyMs: 20 }),
    node("db", "database", { concurrency: 100, latencyMs: 30 }),
  ],
  edges: [edge("client", "api", { latencyMs: 0 }), edge("api", "db")],
};

/** Builds a valid create input, overriding config and identity as needed. */
function input(
  overrides: Partial<CreateSimulationInput> = {},
): CreateSimulationInput {
  return {
    id: "sim-1",
    architectureId: "arch-1",
    architectureSnapshot: pipeline,
    sourceNodeId: "client",
    config: {
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    ...overrides,
  };
}

describe("SimulationOrchestrator", () => {
  let orchestrator: SimulationOrchestrator;

  beforeEach(() => {
    orchestrator = new SimulationOrchestrator();
  });

  describe("create", () => {
    it("creates a run in the created state with the given identity", () => {
      const snapshot = orchestrator.create(input());

      expect(snapshot).toMatchObject({
        id: "sim-1",
        architectureId: "arch-1",
        status: "created",
        currentTimeMs: 0,
      });
      expect(snapshot.startedAt).toBeInstanceOf(Date);
      expect(snapshot.createdAt).toBeInstanceOf(Date);
      expect(snapshot.completedAt).toBeUndefined();
    });

    it("defaults the seed to config.randomSeed, then to zero", () => {
      const fromConfig = orchestrator.create(
        input({ config: { ...input().config, randomSeed: 7 } }),
      );
      expect(fromConfig.seed).toBe(7);

      const noSeed = orchestrator.create(input({ id: "sim-2" }));
      expect(noSeed.seed).toBe(0);

      const explicit = orchestrator.create(
        input({
          id: "sim-3",
          seed: 99,
          config: { ...input().config, randomSeed: 7 },
        }),
      );
      expect(explicit.seed).toBe(99);
    });

    it("rejects a source node that is not in the snapshot", () => {
      expect(() =>
        orchestrator.create(input({ sourceNodeId: "missing" })),
      ).toThrow(/source node not found/i);
    });

    it("rejects a duplicate id", () => {
      orchestrator.create(input());

      expect(() => orchestrator.create(input())).toThrow(/already exists/i);
    });
  });

  describe("runtime isolation", () => {
    it("keeps each run's state independent", () => {
      orchestrator.create(input({ id: "a" }));
      orchestrator.create(input({ id: "b" }));

      orchestrator.start("a");
      orchestrator.step("a");

      expect(orchestrator.getStatus("a")).toBe("running");
      expect(orchestrator.getMetrics("a").requests.generated).toBeGreaterThan(
        0,
      );

      const b = orchestrator.getSnapshot("b");
      expect(b.status).toBe("created");
      expect(b.currentTimeMs).toBe(0);
      expect(orchestrator.getMetrics("b").requests.generated).toBe(0);
    });
  });

  describe("determinism", () => {
    it("produces identical metrics for the same snapshot, config, and seed", () => {
      orchestrator.create(input({ id: "a", seed: 123 }));
      orchestrator.create(input({ id: "b", seed: 123 }));

      const reportA = orchestrator.run("a");
      const reportB = orchestrator.run("b");

      expect(reportA.simulation.status).toBe("completed");
      expect(reportB.simulation.status).toBe("completed");
      // Metrics embed the run id; normalize it so only behavior is compared.
      expect({ ...reportA.metrics, simulationId: "id" }).toEqual({
        ...reportB.metrics,
        simulationId: "id",
      });
    });

    it("produces different results for different seeds", () => {
      const lossyConfig = {
        durationMs: 1000,
        requestsPerSecond: 100,
        simulationSpeed: 1,
        collectMetrics: true,
        emitEvents: true,
      };
      const lossy: ArchitectureGraph = {
        nodes: [
          node("client", "load_balancer"),
          node("api", "api", {
            concurrency: 1000,
            latencyMs: 10,
            errorRate: 0.5,
          }),
        ],
        edges: [edge("client", "api")],
      };

      orchestrator.create(
        input({
          id: "a",
          seed: 1,
          config: lossyConfig,
          architectureSnapshot: lossy,
        }),
      );
      orchestrator.create(
        input({
          id: "b",
          seed: 2,
          config: lossyConfig,
          architectureSnapshot: lossy,
        }),
      );

      const reportA = orchestrator.run("a");
      const reportB = orchestrator.run("b");

      expect(reportA.metrics.requests.failed).not.toBe(
        reportB.metrics.requests.failed,
      );
    });
  });

  describe("lifecycle", () => {
    it("generates traffic and enters running on start", () => {
      orchestrator.create(input());
      const snapshot = orchestrator.start("sim-1");

      expect(snapshot.status).toBe("running");
      expect(orchestrator.getMetrics("sim-1").requests.generated).toBe(10);
    });

    it("processes one event per step and advances the clock", () => {
      orchestrator.create(input());
      orchestrator.start("sim-1");

      const first = orchestrator.step("sim-1");
      expect(first.processed).toBe(true);
      expect(first.simulation.status).toBe("running");

      const second = orchestrator.step("sim-1");
      expect(second.processed).toBe(true);
      expect(second.simulation.currentTimeMs).toBeGreaterThanOrEqual(
        first.simulation.currentTimeMs,
      );
    });

    it("pauses and resumes while preserving the clock", () => {
      orchestrator.create(input());
      orchestrator.start("sim-1");
      orchestrator.step("sim-1");

      const paused = orchestrator.pause("sim-1");
      expect(paused.status).toBe("paused");

      const resumed = orchestrator.resume("sim-1");
      expect(resumed.status).toBe("running");
      expect(resumed.currentTimeMs).toBe(paused.currentTimeMs);
    });

    it("cancels a created, running, or paused run", () => {
      orchestrator.create(input());
      orchestrator.start("sim-1");

      const cancelled = orchestrator.cancel("sim-1");
      expect(cancelled.status).toBe("cancelled");
      expect(orchestrator.getStatus("sim-1")).toBe("cancelled");
    });

    it("rejects a lifecycle transition that is not allowed", () => {
      orchestrator.create(input());

      // Stepping a run that was never started is not allowed.
      expect(() => orchestrator.step("sim-1")).toThrow();
    });

    it("executes to completion with run", () => {
      orchestrator.create(input());
      const report = orchestrator.run("sim-1");

      expect(report.simulation.status).toBe("completed");
      expect(report.simulation.completedAt).toBeInstanceOf(Date);
      expect(report.metrics.requests).toMatchObject({
        generated: 10,
        completed: 10,
        failed: 0,
      });
    });
  });

  describe("read interfaces", () => {
    it("returns a zeroed metrics snapshot when metrics are disabled", () => {
      orchestrator.create(
        input({ config: { ...input().config, collectMetrics: false } }),
      );
      orchestrator.run("sim-1");

      expect(orchestrator.getMetrics("sim-1").requests.generated).toBe(0);
    });

    it("does not expose mutable runtime state through a snapshot", () => {
      orchestrator.create(input());

      const snapshot = orchestrator.getSnapshot("sim-1");
      snapshot.status = "cancelled";
      snapshot.currentTimeMs = 999;
      snapshot.config.durationMs = 1;
      snapshot.config.cacheKeys = ["mutated"];

      const fresh = orchestrator.getSnapshot("sim-1");
      expect(fresh.status).toBe("created");
      expect(fresh.currentTimeMs).toBe(0);
      expect(fresh.config.durationMs).toBe(1000);
      expect(fresh.config.cacheKeys).toBeUndefined();
    });

    it("throws for an unknown simulation id across all operations", () => {
      expect(() => orchestrator.getStatus("missing")).toThrow(/not found/i);
      expect(() => orchestrator.getSnapshot("missing")).toThrow(/not found/i);
      expect(() => orchestrator.getMetrics("missing")).toThrow(/not found/i);
      expect(() => orchestrator.getReport("missing")).toThrow(/not found/i);
      expect(() => orchestrator.start("missing")).toThrow(/not found/i);
      expect(() => orchestrator.step("missing")).toThrow(/not found/i);
      expect(() => orchestrator.run("missing")).toThrow(/not found/i);
      expect(() => orchestrator.pause("missing")).toThrow(/not found/i);
      expect(() => orchestrator.resume("missing")).toThrow(/not found/i);
      expect(() => orchestrator.cancel("missing")).toThrow(/not found/i);
    });
  });
});
