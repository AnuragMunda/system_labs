/**
 * @file scenario-d-packet-loss.test.ts
 *
 * @description Scenario D — network packet loss with retries. Every
 * transmission on the client → api link is lost. Requests must consume their
 * retry budget and then fail with `network_packet_loss`, while the destination
 * that never receives a packet must see no processing traffic at all.
 */

import { describe, expect, it } from "vitest";

import {
  countEvents,
  createHarness,
  edge,
  node,
  requestOutcomes,
  runWithTrace,
} from "./helpers.js";

describe("scenario D: seeded packet loss with retries", () => {
  it("exhausts retries, fails via network_packet_loss, and leaves the destination untouched", () => {
    const graph = {
      nodes: [
        node("client", "load_balancer", {
          retryPolicy: { retries: 2, circuitBreaker: false },
        }),
        node("api", "api", { concurrency: 5, latencyMs: 10 }),
      ],
      edges: [
        // Every packet on this link is dropped.
        edge("client", "api", { latencyMs: 10, packetLossRate: 1 }),
      ],
    };

    const { runtime, session } = createHarness(graph, {
      durationMs: 1000,
      requestsPerSecond: 10,
      seed: 99,
    });

    const trace = runWithTrace(session, "client");
    const metrics = runtime.getMetrics();

    // One initial transmission plus two retries per request.
    expect(metrics.requests.generated).toBe(10);
    expect(metrics.network.transmissions).toBe(30);
    expect(metrics.network.packetLosses).toBe(30);
    expect(metrics.network.packetLossRate).toBe(1);

    expect(metrics.requests.failed).toBe(10);
    expect(metrics.requests.completed).toBe(0);
    expect(metrics.failures.byReason.network_packet_loss).toBe(10);

    // Two retries were scheduled for each of the ten requests.
    expect(countEvents(trace, "request.retry")).toBe(20);
    expect(countEvents(trace, "request.failed")).toBe(10);

    // The destination never received a packet: no capacity, attempts, or work.
    const api = metrics.components.api;

    expect(api.traffic.processed).toBe(0);
    expect(api.traffic.attempts).toBe(0);
    expect(api.traffic.active).toBe(0);

    // Each request ended failed after three attempts (initial + two retries).
    expect(Object.values(requestOutcomes(runtime))).toEqual(
      Array.from({ length: 10 }, () => "failed:3"),
    );
  });
});
