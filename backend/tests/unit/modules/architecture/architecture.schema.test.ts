/**
 * @file architecture.schema.test.ts
 *
 * @description Unit tests for the architecture Zod schemas, covering valid and
 * invalid payloads for create, update, and the id param schema.
 */

import { describe, it, expect } from "vitest";
import {
  architectureSchema,
  idParamSchema,
  updateArchitectureSchema,
} from "../../../../src/modules/architecture/architecture.schema.js";

/** A fully valid architecture payload used as the baseline for tests. */
const validArchitecture = {
  projectId: "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
  name: "Payment Service",
  description: "Handles checkout flows",
  nodes: [
    {
      id: "client-1",
      type: "client",
      name: "Web Client",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "api-1",
      type: "api",
      name: "API Gateway",
      position: { x: 100, y: 50 },
      config: {
        latencyMs: 10,
        capacity: 1000,
        concurrency: 200,
        errorRate: 0.01,
      },
    },
  ],
  edges: [
    {
      id: "e-1",
      source: "client-1",
      target: "api-1",
      config: { latencyMs: 5, bandwidthMbps: 100, packetLossRate: 0.001 },
    },
  ],
};

describe("architectureSchema", () => {
  it("accepts a fully valid architecture payload", () => {
    const result = architectureSchema.safeParse(validArchitecture);
    expect(result.success).toBe(true);
  });

  it("rejects when projectId is missing", () => {
    const { projectId: _projectId, ...without } = validArchitecture;
    expect(architectureSchema.safeParse(without).success).toBe(false);
  });

  it("rejects when name is missing", () => {
    const { name: _name, ...without } = validArchitecture;
    expect(architectureSchema.safeParse(without).success).toBe(false);
  });

  it("rejects when nodes is missing", () => {
    const { nodes: _nodes, ...without } = validArchitecture;
    expect(architectureSchema.safeParse(without).success).toBe(false);
  });

  it("rejects when edges is missing", () => {
    const { edges: _edges, ...without } = validArchitecture;
    expect(architectureSchema.safeParse(without).success).toBe(false);
  });

  it("rejects an empty name", () => {
    const invalid = { ...validArchitecture, name: "" };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown component type", () => {
    const invalid = {
      ...validArchitecture,
      nodes: [{ ...validArchitecture.nodes[0]!, type: "banana" }],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    "client",
    "load_balancer",
    "api",
    "cache",
    "database",
    "queue",
    "worker",
  ])("accepts the %s component type", (type) => {
    const invalid = {
      ...validArchitecture,
      nodes: [{ ...validArchitecture.nodes[0]!, type }],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(true);
  });

  it("rejects a node missing its id", () => {
    const { id: _id, ...node } = validArchitecture.nodes[0]!;
    const invalid = { ...validArchitecture, nodes: [node] };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a node missing its position", () => {
    const { position: _position, ...node } = validArchitecture.nodes[0]!;
    const invalid = { ...validArchitecture, nodes: [node] };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a node missing its config", () => {
    const { config: _config, ...node } = validArchitecture.nodes[0]!;
    const invalid = { ...validArchitecture, nodes: [node] };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a non-numeric position", () => {
    const invalid = {
      ...validArchitecture,
      nodes: [{ ...validArchitecture.nodes[0]!, position: { x: "0", y: 0 } }],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a negative component latencyMs", () => {
    const invalid = {
      ...validArchitecture,
      nodes: [
        {
          ...validArchitecture.nodes[1]!,
          config: { latencyMs: -1 },
        },
      ],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a negative component capacity", () => {
    const invalid = {
      ...validArchitecture,
      nodes: [
        {
          ...validArchitecture.nodes[1]!,
          config: { capacity: -100 },
        },
      ],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a component errorRate outside 0..1", () => {
    const invalid = {
      ...validArchitecture,
      nodes: [
        {
          ...validArchitecture.nodes[1]!,
          config: { errorRate: 1.5 },
        },
      ],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts empty nodes and edges arrays", () => {
    const invalid = { ...validArchitecture, nodes: [], edges: [] };
    expect(architectureSchema.safeParse(invalid).success).toBe(true);
  });

  it("rejects an edge missing its source", () => {
    const { source: _source, ...edge } = validArchitecture.edges[0]!;
    const invalid = { ...validArchitecture, edges: [edge] };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an edge missing its target", () => {
    const { target: _target, ...edge } = validArchitecture.edges[0]!;
    const invalid = { ...validArchitecture, edges: [edge] };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an edge missing its config", () => {
    const { config: _config, ...edge } = validArchitecture.edges[0]!;
    const invalid = { ...validArchitecture, edges: [edge] };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a negative connection latencyMs", () => {
    const invalid = {
      ...validArchitecture,
      edges: [{ ...validArchitecture.edges[0]!, config: { latencyMs: -1 } }],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a negative bandwidthMbps", () => {
    const invalid = {
      ...validArchitecture,
      edges: [
        { ...validArchitecture.edges[0]!, config: { bandwidthMbps: -10 } },
      ],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a packetLossRate above 1", () => {
    const invalid = {
      ...validArchitecture,
      edges: [
        { ...validArchitecture.edges[0]!, config: { packetLossRate: 1.1 } },
      ],
    };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a null description", () => {
    const invalid = { ...validArchitecture, description: null };
    expect(architectureSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("architectureSchema autoscaling config", () => {
  const nodeWithAutoscaling = (autoscaling: unknown) => ({
    ...validArchitecture.nodes[1]!,
    config: {
      ...validArchitecture.nodes[1]!.config,
      autoscaling,
    },
  });

  const payloadWith = (autoscaling: unknown) => ({
    ...validArchitecture,
    nodes: [nodeWithAutoscaling(autoscaling)],
  });

  it("accepts a valid autoscaling configuration", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 1, max: 5, targetCpu: 50 }),
      ).success,
    ).toBe(true);
  });

  it("accepts an autoscaling configuration with equal min and max", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 1, max: 1, targetCpu: 50 }),
      ).success,
    ).toBe(true);
  });

  it("rejects a min below 1", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 0, max: 5, targetCpu: 50 }),
      ).success,
    ).toBe(false);
  });

  it("rejects a max below 1", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 1, max: 0, targetCpu: 50 }),
      ).success,
    ).toBe(false);
  });

  it("rejects a max below min", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 5, max: 2, targetCpu: 50 }),
      ).success,
    ).toBe(false);
  });

  it("rejects a negative targetCpu", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 1, max: 5, targetCpu: -1 }),
      ).success,
    ).toBe(false);
  });

  it("rejects a targetCpu above 100", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 1, max: 5, targetCpu: 101 }),
      ).success,
    ).toBe(false);
  });

  it("rejects a non-integer min", () => {
    expect(
      architectureSchema.safeParse(
        payloadWith({ enabled: true, min: 1.5, max: 5, targetCpu: 50 }),
      ).success,
    ).toBe(false);
  });
});

describe("architectureSchema queue config", () => {
  const payloadWithQueue = (queue: unknown) => ({
    ...validArchitecture,
    nodes: [
      validArchitecture.nodes[0]!,
      {
        ...validArchitecture.nodes[1]!,
        config: {
          ...validArchitecture.nodes[1]!.config,
          queue,
        },
      },
    ],
  });

  it("preserves a valid queue configuration through parsing", () => {
    const result = architectureSchema.safeParse(
      payloadWithQueue({
        enabled: true,
        maxSize: 4,
        overflowStrategy: "drop_oldest",
      }),
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.nodes[1]!.config).toMatchObject({
        queue: { enabled: true, maxSize: 4, overflowStrategy: "drop_oldest" },
      });
    }
  });

  it("accepts a maxSize of 0 (a queue that never waits)", () => {
    expect(
      architectureSchema.safeParse(payloadWithQueue({ maxSize: 0 })).success,
    ).toBe(true);
  });

  it("rejects an unknown overflow strategy", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithQueue({ maxSize: 1, overflowStrategy: "explode" }),
      ).success,
    ).toBe(false);
  });

  it("rejects a negative maxSize", () => {
    expect(
      architectureSchema.safeParse(payloadWithQueue({ maxSize: -1 })).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxSize", () => {
    expect(
      architectureSchema.safeParse(payloadWithQueue({ maxSize: 1.5 })).success,
    ).toBe(false);
  });
});

describe("architectureSchema capacity config", () => {
  const payloadWithConfig = (config: unknown) => ({
    ...validArchitecture,
    nodes: [
      validArchitecture.nodes[0]!,
      {
        ...validArchitecture.nodes[1]!,
        config,
      },
    ],
  });

  it("rejects replicas of 0", () => {
    expect(
      architectureSchema.safeParse(payloadWithConfig({ replicas: 0 })).success,
    ).toBe(false);
  });

  it("rejects fractional replicas", () => {
    expect(
      architectureSchema.safeParse(payloadWithConfig({ replicas: 1.5 }))
        .success,
    ).toBe(false);
  });

  it("rejects concurrency of 0", () => {
    expect(
      architectureSchema.safeParse(payloadWithConfig({ concurrency: 0 }))
        .success,
    ).toBe(false);
  });

  it("rejects fractional concurrency", () => {
    expect(
      architectureSchema.safeParse(payloadWithConfig({ concurrency: 1.5 }))
        .success,
    ).toBe(false);
  });

  it("accepts positive integer replicas and concurrency", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithConfig({ replicas: 2, concurrency: 4 }),
      ).success,
    ).toBe(true);
  });

  it("rejects explicit replicas outside an enabled autoscaling band", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithConfig({
          replicas: 2,
          autoscaling: { enabled: true, min: 3, max: 6, targetCpu: 70 },
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts explicit replicas inside an enabled autoscaling band", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithConfig({
          replicas: 4,
          autoscaling: { enabled: true, min: 3, max: 6, targetCpu: 70 },
        }),
      ).success,
    ).toBe(true);
  });

  it("allows explicit replicas outside the band when autoscaling is disabled", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithConfig({
          replicas: 2,
          autoscaling: { enabled: false, min: 3, max: 6, targetCpu: 70 },
        }),
      ).success,
    ).toBe(true);
  });

  it("preserves cache, routing, health, and recovery configuration through parsing", () => {
    const result = architectureSchema.safeParse(
      payloadWithConfig({
        cache: { ttlMs: 1000, capacity: 8, hitLatencyMs: 1, missLatencyMs: 5 },
        routingStrategy: "least_connections",
        healthThresholds: {
          utilization: { degraded: 0.7, critical: 0.9 },
          errorRate: { degraded: 0.05, critical: 0.2 },
          latencyMs: { degraded: 100, critical: 500 },
        },
        recoveryDelayMs: 200,
      }),
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.nodes[1]!.config).toMatchObject({
        cache: { ttlMs: 1000, capacity: 8, hitLatencyMs: 1, missLatencyMs: 5 },
        routingStrategy: "least_connections",
        healthThresholds: {
          utilization: { degraded: 0.7, critical: 0.9 },
          errorRate: { degraded: 0.05, critical: 0.2 },
          latencyMs: { degraded: 100, critical: 500 },
        },
        recoveryDelayMs: 200,
      });
    }
  });

  it("rejects an unknown routing strategy", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithConfig({ routingStrategy: "spray" }),
      ).success,
    ).toBe(false);
  });

  it("rejects a cache configuration missing its required fields", () => {
    expect(
      architectureSchema.safeParse(
        payloadWithConfig({ cache: { capacity: 8 } }),
      ).success,
    ).toBe(false);
  });
});

describe("updateArchitectureSchema", () => {
  it("accepts an empty object", () => {
    const result = updateArchitectureSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts only a name", () => {
    expect(
      updateArchitectureSchema.safeParse({ name: "New Name" }).success,
    ).toBe(true);
  });

  it("accepts only a description", () => {
    expect(
      updateArchitectureSchema.safeParse({ description: "Updated" }).success,
    ).toBe(true);
  });

  it("accepts only nodes", () => {
    expect(
      updateArchitectureSchema.safeParse({ nodes: validArchitecture.nodes })
        .success,
    ).toBe(true);
  });

  it("accepts only edges", () => {
    expect(
      updateArchitectureSchema.safeParse({ edges: validArchitecture.edges })
        .success,
    ).toBe(true);
  });

  it("accepts a combination of fields", () => {
    expect(
      updateArchitectureSchema.safeParse({ name: "X", nodes: [], edges: [] })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid field value", () => {
    expect(updateArchitectureSchema.safeParse({ name: "" }).success).toBe(
      false,
    );
  });

  it("still validates nodes when present", () => {
    expect(
      updateArchitectureSchema.safeParse({
        nodes: [{ ...validArchitecture.nodes[0]!, type: "banana" }],
      }).success,
    ).toBe(false);
  });

  it("strips projectId from the parsed result", () => {
    const result = updateArchitectureSchema.safeParse({
      projectId: "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
      name: "Renamed",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect("projectId" in result.data).toBe(false);
    }
  });
});

describe("idParamSchema", () => {
  it("accepts a valid uuid", () => {
    expect(
      idParamSchema.safeParse({ id: "5b47bb24-2f9b-4e40-a1c5-4d2d5bce0f91" })
        .success,
    ).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(idParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a missing id", () => {
    expect(idParamSchema.safeParse({}).success).toBe(false);
  });
});
