/**
 * @file scenario-b-cache.test.ts
 *
 * @description Scenario B — a cache in front of a database. With a small,
 * reused pool of resource keys, the cache must warm up: initial requests miss
 * (and populate the cache), later requests hit, and the event stream must
 * agree with the aggregated hit/miss metrics.
 */

import { describe, expect, it } from "vitest";

import {
  countEvents,
  createHarness,
  edge,
  node,
  runWithTrace,
} from "./helpers.js";

describe("scenario B: cache miss → populate → hit", () => {
  const graph = {
    nodes: [
      node("client", "load_balancer"),
      node("api", "api", { concurrency: 50, latencyMs: 5 }),
      node("cache", "cache", {
        cache: { capacity: 8, ttlMs: 5000, hitLatencyMs: 1, missLatencyMs: 4 },
      }),
      node("db", "database", { concurrency: 50, latencyMs: 10 }),
    ],
    edges: [
      edge("client", "api", { latencyMs: 0 }),
      edge("api", "cache", { latencyMs: 0 }),
      edge("cache", "db", { latencyMs: 0 }),
    ],
  };

  it("warms the cache and reports hits consistent with the event stream", () => {
    const { runtime, session } = createHarness(graph, {
      durationMs: 2000,
      requestsPerSecond: 20,
      cacheKeys: ["GET:/users/1", "GET:/users/2"],
    });

    const trace = runWithTrace(session, "client");
    const metrics = runtime.getMetrics();
    const cache = metrics.cache.totals;

    // The small key pool guarantees both misses (warm-up) and hits.
    expect(cache.misses).toBeGreaterThan(0);
    expect(cache.hits).toBeGreaterThan(0);
    expect(cache.requests).toBe(cache.hits + cache.misses);
    expect(cache.hitRatio).toBeCloseTo(cache.hits / cache.requests, 5);

    // The emitted cache events are the source of truth for the metrics.
    expect(countEvents(trace, "cache.hit")).toBe(cache.hits);
    expect(countEvents(trace, "cache.miss")).toBe(cache.misses);

    // Every request still terminates exactly once.
    expect(metrics.requests.completed).toBe(metrics.requests.generated);
    expect(metrics.requests.inFlight).toBe(0);
  });

  it("serves every subsequent lookup after the first from cache", () => {
    const { runtime, session } = createHarness(graph, {
      durationMs: 2000,
      requestsPerSecond: 20,
      cacheKeys: ["GET:/users/1"],
    });

    runWithTrace(session, "client");

    const metrics = runtime.getMetrics();

    // With a single key only the first lookup misses; every other request is
    // served without another database hop.
    expect(metrics.cache.byNode.cache.misses).toBe(1);
    expect(metrics.cache.byNode.cache.hits).toBe(
      metrics.requests.generated - 1,
    );

    // Miss-driven database traffic can never exceed the number of misses.
    const databaseRequests = metrics.database.byNode.db?.requests ?? 0;

    expect(databaseRequests).toBeLessThanOrEqual(
      metrics.cache.byNode.cache.misses,
    );
  });
});
