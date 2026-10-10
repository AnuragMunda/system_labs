/**
 * @file scenario-a-pipeline.test.ts
 *
 * @description Scenario A — a healthy end-to-end request pipeline. A client
 * drives load through an API into a database; every request must complete,
 * end-to-end latency must reflect the processing hops, and the emitted event
 * stream must be well ordered.
 */

import { describe, expect, it } from "vitest";

import {
  countEvents,
  createHarness,
  edge,
  node,
  runWithTrace,
} from "./helpers.js";

describe("scenario A: client → api → database pipeline", () => {
  const graph = {
    nodes: [
      node("client", "load_balancer"),
      node("api", "api", { concurrency: 100, latencyMs: 20 }),
      node("db", "database", { concurrency: 100, latencyMs: 30 }),
    ],
    edges: [
      edge("client", "api", { latencyMs: 0 }),
      edge("api", "db", { latencyMs: 0 }),
    ],
  };

  it("completes every request and reports the expected end-to-end latency", () => {
    const { runtime, session } = createHarness(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
    });

    runWithTrace(session, "client");
    const metrics = runtime.getMetrics();

    expect(runtime.simulation.status).toBe("completed");
    expect(metrics.requests).toMatchObject({
      generated: 10,
      completed: 10,
      failed: 0,
      inFlight: 0,
      queued: 0,
      successRate: 1,
      errorRate: 0,
    });

    // Two links per request and a 20ms + 30ms processing path.
    expect(metrics.network.transmissions).toBe(20);
    expect(metrics.latency.endToEnd).toMatchObject({
      count: 10,
      avgMs: 50,
      minMs: 50,
      maxMs: 50,
    });
    expect(metrics.latency.processing.byNode.api).toMatchObject({
      count: 10,
      avgMs: 20,
    });
    expect(metrics.latency.processing.byNode.db).toMatchObject({
      count: 10,
      avgMs: 30,
    });
  });

  it("emits a well-ordered event stream with each request completing exactly once", () => {
    const { session } = createHarness(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
    });

    const trace = runWithTrace(session, "client");

    // Virtual time never moves backwards.
    const timestamps = trace.map((event) => event.timestampMs);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

    expect(countEvents(trace, "request.created")).toBe(10);
    expect(countEvents(trace, "request.completed")).toBe(10);
    expect(countEvents(trace, "request.failed")).toBe(0);

    // Every created request reaches exactly one terminal completion.
    const completed = new Set(
      trace
        .filter((event) => event.type === "request.completed")
        .map((event) => event.requestId),
    );

    expect(completed.size).toBe(10);
  });
});
