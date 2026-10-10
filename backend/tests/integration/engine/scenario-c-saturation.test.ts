/**
 * @file scenario-c-saturation.test.ts
 *
 * @description Scenario C — saturation and autoscaling. A single-slot API is
 * driven harder than it can serve, so requests queue; the queue must drain in
 * FIFO order and the API must never exceed its effective concurrency while
 * autoscaling reacts to the pressure.
 */

import { describe, expect, it } from "vitest";

import { createHarness, edge, node, runWithTrace } from "./helpers.js";

describe("scenario C: saturation, queueing, and autoscaling", () => {
  it("queues under saturation, drains FIFO, and never exceeds effective concurrency", () => {
    const graph = {
      nodes: [
        node("client", "load_balancer"),
        node("api", "api", {
          concurrency: 1,
          latencyMs: 20,
          queue: { maxSize: 50 },
          autoscaling: { enabled: true, min: 1, max: 4, targetCpu: 50 },
        }),
        node("db", "database", { concurrency: 100, latencyMs: 5 }),
      ],
      edges: [
        edge("client", "api", { latencyMs: 0 }),
        edge("api", "db", { latencyMs: 0 }),
      ],
    };

    const { runtime, session } = createHarness(graph, {
      durationMs: 2500,
      requestsPerSecond: 100,
      seed: 7,
    });

    const trace = runWithTrace(session, "client");
    const metrics = runtime.getMetrics();
    const api = metrics.components.api;

    // The load saturated the single slot and produced real queueing.
    expect(api.queue.totalEnqueued).toBeGreaterThan(0);
    expect(api.queue.peakDepth).toBeGreaterThan(0);
    expect(metrics.queues.totals.enqueued).toBeGreaterThan(0);

    // Invariant: the component never processed more concurrently than its
    // effective concurrency (concurrency × current replicas).
    const effectiveConcurrency =
      api.autoscaling.currentReplicas * /* concurrency */ 1;

    expect(api.traffic.active).toBeLessThanOrEqual(effectiveConcurrency);
    expect(api.traffic.peakActive).toBeLessThanOrEqual(
      api.autoscaling.maxReplicas * 1,
    );

    // Autoscaling was configured and did evaluate the component.
    expect(api.autoscaling.enabled).toBe(true);
    expect(api.autoscaling.evaluations).toBeGreaterThan(0);

    // Queue drain is FIFO: every dequeued request was enqueued earlier and in
    // the same relative order.
    const enqueued = trace
      .filter((event) => event.type === "queue.enqueue")
      .map((event) => event.requestId);
    const dequeued = trace
      .filter((event) => event.type === "queue.dequeue")
      .map((event) => event.requestId);

    expect(dequeued).toEqual(enqueued.slice(0, dequeued.length));
    expect(dequeued.length).toBe(api.queue.totalDequeued);
  });
});
