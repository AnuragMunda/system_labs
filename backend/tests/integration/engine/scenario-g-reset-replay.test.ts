/**
 * @file scenario-g-reset-replay.test.ts
 *
 * @description Scenario G — full-run determinism and reset/replay. A rich
 * session run (routing, autoscaling, retries, circuit breaking, recovery,
 * cache, database, packet loss) is rewound with `runtime.reset()` and replayed;
 * the replay must match a fresh runtime driven by the same seed exactly —
 * event stream, metrics, and request outcomes.
 */

import { describe, expect, it } from "vitest";

import {
  createHarness,
  edge,
  node,
  requestOutcomes,
  runWithTrace,
  type SimulationOverrides,
} from "./helpers.js";
import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";

function richGraph(): ArchitectureGraph {
  return {
    nodes: [
      node("client", "load_balancer", { routingStrategy: "round_robin" }),
      node("api1", "api", {
        concurrency: 2,
        latencyMs: 5,
        replicas: 1,
        autoscaling: { enabled: true, min: 1, max: 4, targetCpu: 50 },
        retryPolicy: {
          retries: 2,
          circuitBreaker: {
            enabled: true,
            failureThreshold: 5,
            openDurationMs: 200,
          },
        },
        recoveryDelayMs: 150,
      }),
      node("api2", "api", { concurrency: 2, latencyMs: 8, replicas: 1 }),
      node("cache", "cache", {
        cache: { capacity: 8, ttlMs: 500, hitLatencyMs: 2, missLatencyMs: 10 },
      }),
      node("db", "database", { latencyMs: 12, concurrency: 4 }),
    ],
    edges: [
      edge("client", "api1", { latencyMs: 4, packetLossRate: 0.1 }),
      edge("client", "api2", { latencyMs: 7, packetLossRate: 0.05 }),
      edge("api1", "cache", { latencyMs: 2 }),
      edge("api2", "cache", { latencyMs: 3 }),
      edge("cache", "db", { latencyMs: 6, bandwidthMbps: 100 }),
    ],
  };
}

const overrides: SimulationOverrides = {
  durationMs: 2500,
  requestsPerSecond: 40,
  seed: 1337,
  cacheKeys: ["GET:/users/1", "GET:/users/2", "GET:/users/3"],
  databaseOperations: ["read", "write"],
  failures: [{ nodeId: "api1", failedAtMs: 300 }],
};

describe("scenario G: determinism and reset/replay", () => {
  it("replays a full run identically after a reset and matches a fresh runtime", () => {
    const runtimeA = createHarness(richGraph(), overrides);

    const first = runWithTrace(runtimeA.session, "client");

    expect(runtimeA.runtime.simulation.status).toBe("completed");

    runtimeA.runtime.reset();

    expect(runtimeA.runtime.simulation.status).toBe("created");
    expect(runtimeA.runtime.eventQueue.isEmpty()).toBe(true);

    // Same runtime and session, rewound to the start.
    const replay = runWithTrace(runtimeA.session, "client");

    // Independent fresh runtime with identical seed and inputs.
    const runtimeB = createHarness(richGraph(), overrides);
    const fresh = runWithTrace(runtimeB.session, "client");

    expect(replay).toEqual(fresh);
    expect(first).toEqual(fresh);

    expect(runtimeA.runtime.getMetrics()).toEqual(
      runtimeB.runtime.getMetrics(),
    );
    expect(requestOutcomes(runtimeA.runtime)).toEqual(
      requestOutcomes(runtimeB.runtime),
    );
  });
});
