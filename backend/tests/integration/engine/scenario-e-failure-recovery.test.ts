/**
 * @file scenario-e-failure-recovery.test.ts
 *
 * @description Scenario E — scheduled component failure and automatic
 * recovery. While the API is failed its arrivals are rejected; once it
 * recovers, traffic resumes and requests complete again. The failure and
 * recovery transitions must be observable and correctly ordered.
 */

import { describe, expect, it } from "vitest";

import {
  countEvents,
  createHarness,
  edge,
  indicesOf,
  node,
  runWithTrace,
} from "./helpers.js";

describe("scenario E: failure window and automatic recovery", () => {
  const graph = {
    nodes: [
      node("client", "load_balancer"),
      node("api", "api", {
        concurrency: 2,
        latencyMs: 10,
        recoveryDelayMs: 100,
      }),
      node("db", "database", { concurrency: 50, latencyMs: 10 }),
    ],
    edges: [
      edge("client", "api", { latencyMs: 5 }),
      edge("api", "db", { latencyMs: 5 }),
    ],
  };

  it("rejects arrivals while failed and resumes completion after recovery", () => {
    const { runtime, session } = createHarness(graph, {
      durationMs: 1000,
      requestsPerSecond: 20,
      failures: [{ nodeId: "api", failedAtMs: 200 }],
    });

    const trace = runWithTrace(session, "client");
    const metrics = runtime.getMetrics();

    // The failure and its automatic recovery each happened exactly once and
    // in the right order.
    expect(countEvents(trace, "component.failed")).toBe(1);
    expect(countEvents(trace, "component.recovery_scheduled")).toBe(1);
    expect(countEvents(trace, "component.recovered")).toBe(1);

    const [failedIndex] = indicesOf(trace, "component.failed");
    const [recoveredIndex] = indicesOf(trace, "component.recovered");

    expect(recoveredIndex).toBeGreaterThan(failedIndex);

    expect(metrics.health.byNode.api).toMatchObject({
      state: "healthy",
      failures: 1,
      recoveries: 1,
    });

    // Some arrivals landed in the failure window and failed terminally.
    expect(metrics.failures.byReason.component_failed).toBeGreaterThan(0);

    // Traffic resumed after recovery: the run finished with completions and
    // no in-flight requests left behind.
    expect(metrics.requests.completed).toBeGreaterThan(0);
    expect(metrics.requests.inFlight).toBe(0);
    expect(metrics.components.api.traffic.processed).toBeGreaterThan(0);

    // Every request reached a terminal state.
    expect(metrics.requests.completed + metrics.requests.failed).toBe(
      metrics.requests.generated,
    );
  });
});
