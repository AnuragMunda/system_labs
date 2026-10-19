import { describe, expect, it } from "vitest";

import {
  componentHealthToHealth,
  componentMetricsToLive,
  isActiveStatus,
  isTerminalStatus,
  metricsToNodeHealth,
  metricsToNodeLive,
  metricsToTelemetry,
  runProgressPercent,
  statusLabel,
  statusTone,
} from "./mapping";
import type { ComponentMetrics, SimulationMetrics } from "@/lib/api/simulations";

function makeEndToEndLatency() {
  return {
    count: 1,
    avgMs: 10,
    p50Ms: 8,
    p95Ms: 20,
    p99Ms: 40,
    minMs: 1,
    maxMs: 50,
  };
}

function makeComponent(nodeId: string): ComponentMetrics {
  return {
    nodeId,
    type: "api",
    traffic: {
      active: 0,
      peakActive: 5,
      processed: 300,
      attempts: 300,
      failedAttempts: 30,
      retries: 0,
    },
    latency: {
      totalMs: 3000,
      avgMs: 10,
      lastMs: 9,
      minMs: 1,
      maxMs: 50,
      p50Ms: 8,
      p95Ms: 20,
      p99Ms: 40,
    },
    queue: {
      currentDepth: 0,
      peakDepth: 3,
      totalEnqueued: 10,
      totalDequeued: 10,
      totalDropped: 0,
      totalRejected: 0,
      wait: makeEndToEndLatency(),
    },
    health: {
      state: "degraded",
      transitions: 1,
      failures: 0,
      recoveries: 0,
      timeInStateMs: {},
    },
  };
}

function makeMetrics(): SimulationMetrics {
  return {
    simulationId: "sim-1",
    durationMs: 60000,
    processedDurationMs: 30000,
    recordedAtMs: 30000,
    collectMetrics: true,
    requests: {
      generated: 3000,
      completed: 2900,
      failed: 100,
      retries: 0,
      inFlight: 0,
      queued: 0,
      successRate: 0.966,
      errorRate: 0.033,
      failedByReason: {},
    },
    failures: { total: 100, byReason: {}, byNode: {} },
    network: {
      transmissions: 2900,
      packetLosses: 5,
      packetLossRate: 0.0017,
      totalLatencyMs: 5000,
    },
    latency: {
      endToEnd: makeEndToEndLatency(),
      failed: makeEndToEndLatency(),
      network: makeEndToEndLatency(),
    },
    components: { "api-1": makeComponent("api-1") },
  };
}

describe("simulation status helpers", () => {
  it("classifies active and terminal statuses", () => {
    expect(isActiveStatus("running")).toBe(true);
    expect(isActiveStatus("paused")).toBe(true);
    expect(isActiveStatus("created")).toBe(true);
    expect(isActiveStatus("completed")).toBe(false);
    expect(isActiveStatus("failed")).toBe(false);
    expect(isActiveStatus("cancelled")).toBe(false);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("maps status labels and tones", () => {
    expect(statusLabel("running")).toBe("Running");
    expect(statusTone("running")).toBe("active");
    expect(statusTone("completed")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("cancelled")).toBe("neutral");
  });
});

describe("runProgressPercent", () => {
  it("computes clamped progress", () => {
    expect(runProgressPercent(30000, 60000)).toBe(50);
    expect(runProgressPercent(0, 60000)).toBe(0);
    expect(runProgressPercent(120000, 60000)).toBe(100);
    expect(runProgressPercent(30000, 0)).toBe(0);
  });
});

describe("componentHealthToHealth", () => {
  it("maps backend health states to editor health", () => {
    expect(componentHealthToHealth("healthy")).toBe("healthy");
    expect(componentHealthToHealth("degraded")).toBe("degraded");
    expect(componentHealthToHealth("failed")).toBe("critical");
  });
});

describe("metricsToTelemetry", () => {
  it("derives traffic, p95 and error rate from metrics", () => {
    const telemetry = metricsToTelemetry(makeMetrics(), []);
    expect(telemetry.traffic).toBeCloseTo(2900 / 30, 1);
    expect(telemetry.p95).toBe(20);
    expect(telemetry.errorRate).toBeCloseTo(0.033, 3);
    expect(telemetry.cost).toBe(0);
  });
});

describe("component live metrics", () => {
  it("computes per-component rps and error rate", () => {
    const live = componentMetricsToLive(makeComponent("api-1"), 30000);
    expect(live.rps).toBeCloseTo(300 / 30, 1);
    expect(live.p50).toBe(8);
    expect(live.p95).toBe(20);
    expect(live.p99).toBe(40);
    expect(live.errorRate).toBeCloseTo(0.1, 3);
    expect(live.queueDepth).toBe(0);
  });

  it("maps metrics to node live and health records", () => {
    const metrics = makeMetrics();
    expect(metricsToNodeLive(metrics)["api-1"].rps).toBeCloseTo(10, 1);
    expect(metricsToNodeHealth(metrics)["api-1"]).toBe("degraded");
  });
});
