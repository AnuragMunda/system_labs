/**
 * @file simulation.schema.test.ts
 *
 * @description Unit tests for the simulation Zod schemas. Covers config
 * defaults/bounds, the failure-time invariant (failures must land before the
 * run's duration), the create body, and the id param schema.
 */

import { describe, it, expect } from "vitest";

import {
  createSimulationSchema,
  idParamSchema,
  simulationConfigSchema,
} from "../../../../src/modules/simulation/simulation.schema.js";

const uuid = "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91";

/** A minimal valid config used as the baseline for config tests. */
const validConfig = {
  durationMs: 1000,
  requestsPerSecond: 10,
};

/** A minimal valid create payload used as the baseline for create tests. */
const validCreate = {
  architectureId: uuid,
  sourceNodeId: "client-1",
  config: validConfig,
};

describe("simulationConfigSchema", () => {
  it("accepts a minimal config and applies defaults", () => {
    const result = simulationConfigSchema.safeParse(validConfig);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        simulationSpeed: 1,
        collectMetrics: true,
        emitEvents: true,
      });
    }
  });

  it("accepts the full optional surface", () => {
    const result = simulationConfigSchema.safeParse({
      ...validConfig,
      simulationSpeed: 2,
      randomSeed: 42,
      collectMetrics: false,
      emitEvents: false,
      cacheKeys: ["a", "b"],
      databaseOperations: ["read", "write"],
      failures: [{ nodeId: "db", failedAtMs: 100 }],
    });

    expect(result.success).toBe(true);
  });

  it.each([0, -1, 1.5])("rejects a durationMs of %s", (durationMs) => {
    expect(
      simulationConfigSchema.safeParse({ ...validConfig, durationMs }).success,
    ).toBe(false);
  });

  it("rejects a missing durationMs", () => {
    const { durationMs: _durationMs, ...without } = validConfig;
    expect(simulationConfigSchema.safeParse(without).success).toBe(false);
  });

  it("rejects a negative requestsPerSecond", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        requestsPerSecond: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts a requestsPerSecond of zero", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        requestsPerSecond: 0,
      }).success,
    ).toBe(true);
  });

  it.each([0, -1])("rejects a simulationSpeed of %s", (simulationSpeed) => {
    expect(
      simulationConfigSchema.safeParse({ ...validConfig, simulationSpeed })
        .success,
    ).toBe(false);
  });

  it("rejects a fractional randomSeed", () => {
    expect(
      simulationConfigSchema.safeParse({ ...validConfig, randomSeed: 1.5 })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown database operation", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        databaseOperations: ["delete"],
      }).success,
    ).toBe(false);
  });

  it("rejects a failure missing its nodeId", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        failures: [{ failedAtMs: 100 }],
      }).success,
    ).toBe(false);
  });

  it("rejects a negative failedAtMs", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        failures: [{ nodeId: "db", failedAtMs: -1 }],
      }).success,
    ).toBe(false);
  });

  it("accepts a failure scheduled strictly before the duration", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        failures: [{ nodeId: "db", failedAtMs: 999 }],
      }).success,
    ).toBe(true);
  });

  it("rejects a failure scheduled at the duration boundary", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        failures: [{ nodeId: "db", failedAtMs: 1000 }],
      }).success,
    ).toBe(false);
  });

  it("rejects a failure scheduled after the duration", () => {
    expect(
      simulationConfigSchema.safeParse({
        ...validConfig,
        failures: [{ nodeId: "db", failedAtMs: 1001 }],
      }).success,
    ).toBe(false);
  });
});

describe("createSimulationSchema", () => {
  it("accepts a valid create payload", () => {
    expect(createSimulationSchema.safeParse(validCreate).success).toBe(true);
  });

  it("rejects a missing architectureId", () => {
    const { architectureId: _architectureId, ...without } = validCreate;
    expect(createSimulationSchema.safeParse(without).success).toBe(false);
  });

  it("rejects a non-uuid architectureId", () => {
    expect(
      createSimulationSchema.safeParse({
        ...validCreate,
        architectureId: "arch-1",
      }).success,
    ).toBe(false);
  });

  it("rejects a missing sourceNodeId", () => {
    const { sourceNodeId: _sourceNodeId, ...without } = validCreate;
    expect(createSimulationSchema.safeParse(without).success).toBe(false);
  });

  it("rejects an empty sourceNodeId", () => {
    expect(
      createSimulationSchema.safeParse({ ...validCreate, sourceNodeId: "" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing config", () => {
    const { config: _config, ...without } = validCreate;
    expect(createSimulationSchema.safeParse(without).success).toBe(false);
  });

  it("rejects a config that violates the failure-time invariant", () => {
    expect(
      createSimulationSchema.safeParse({
        ...validCreate,
        config: {
          ...validConfig,
          failures: [{ nodeId: "db", failedAtMs: 5000 }],
        },
      }).success,
    ).toBe(false);
  });

  it("strips unknown top-level fields from the parsed result", () => {
    const result = createSimulationSchema.safeParse({
      ...validCreate,
      ownerId: uuid,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect("ownerId" in result.data).toBe(false);
    }
  });
});

describe("idParamSchema", () => {
  it("accepts a valid uuid", () => {
    expect(idParamSchema.safeParse({ id: uuid }).success).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(idParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a missing id", () => {
    expect(idParamSchema.safeParse({}).success).toBe(false);
  });
});
