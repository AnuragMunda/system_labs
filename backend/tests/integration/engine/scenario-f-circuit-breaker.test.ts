/**
 * @file scenario-f-circuit-breaker.test.ts
 *
 * @description Scenario F — circuit breaker under a total processing outage.
 * With `errorRate: 1`, consecutive failures trip the breaker; while it is open
 * new arrivals fail fast without consuming attempts, and the scheduled
 * half-open transition lets a single probe through that re-opens the circuit.
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

describe("scenario F: circuit breaker under total failure", () => {
  const graph = {
    nodes: [
      node("client", "load_balancer"),
      node("api", "api", {
        concurrency: 4,
        latencyMs: 5,
        errorRate: 1,
        retryPolicy: {
          retries: 0,
          circuitBreaker: {
            enabled: true,
            failureThreshold: 3,
            openDurationMs: 100,
          },
        },
      }),
      node("db", "database", { concurrency: 50, latencyMs: 5 }),
    ],
    edges: [
      edge("client", "api", { latencyMs: 0 }),
      edge("api", "db", { latencyMs: 0 }),
    ],
  };

  it("opens after consecutive failures, fails fast while open, and probes while half-open", () => {
    const { runtime, session } = createHarness(graph, {
      durationMs: 1000,
      requestsPerSecond: 20,
      seed: 5,
    });

    const trace = runWithTrace(session, "client");
    const metrics = runtime.getMetrics();

    // The breaker actually tripped and advanced to half-open at least once.
    expect(countEvents(trace, "component.circuit_opened")).toBeGreaterThan(0);
    expect(countEvents(trace, "component.circuit_half_open")).toBeGreaterThan(
      0,
    );

    const [openedIndex] = indicesOf(trace, "component.circuit_opened");
    const [halfOpenIndex] = indicesOf(trace, "component.circuit_half_open");

    expect(halfOpenIndex).toBeGreaterThan(openedIndex);

    // Failures are a mix of the underlying processing outage and fast-fail
    // circuit rejections.
    expect(metrics.failures.byReason.component_error).toBeGreaterThan(0);
    expect(metrics.failures.byReason.circuit_open).toBeGreaterThan(0);

    // Fast-failed requests never consumed an attempt, while requests that
    // failed in processing did.
    const circuitOpenRequestIds = trace
      .filter(
        (event) =>
          event.type === "request.failed" && event.reason === "circuit_open",
      )
      .map((event) => event.requestId);

    expect(circuitOpenRequestIds.length).toBeGreaterThan(0);

    for (const requestId of circuitOpenRequestIds) {
      expect(runtime.getRequest(requestId!).attempts).toBe(0);
    }

    const componentErrorRequestIds = trace
      .filter(
        (event) =>
          event.type === "request.failed" && event.reason === "component_error",
      )
      .map((event) => event.requestId);

    for (const requestId of componentErrorRequestIds) {
      expect(runtime.getRequest(requestId!).attempts).toBeGreaterThanOrEqual(1);
    }

    // No request could complete under a total outage.
    expect(metrics.requests.completed).toBe(0);

    // The breaker ended tripped (open or half-open) with a bumped generation.
    const circuit = runtime.getCircuitState("api");

    expect(["open", "half-open"]).toContain(circuit.state);
    expect(circuit.generation).toBeGreaterThanOrEqual(1);
  });
});
