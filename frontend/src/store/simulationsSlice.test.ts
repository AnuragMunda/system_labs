import { describe, expect, it } from "vitest";

import reducer, {
  clearCreateError,
  createSimulation,
  fetchSimulationMetrics,
  fetchSimulationResults,
  refreshSimulationStatus,
  startSimulation,
} from "./simulationsSlice";
import type {
  CreateSimulationInput,
  SimulationDetails,
  SimulationMetrics,
} from "@/lib/api/simulations";

const INITIAL = reducer(undefined, { type: "@@INIT" });

function makeDetails(
  overrides: Partial<SimulationDetails> = {},
): SimulationDetails {
  return {
    id: "sim-1",
    architectureId: "arch-1",
    status: "created",
    seed: 42,
    currentTimeMs: 0,
    sourceNodeId: "src",
    config: { durationMs: 60000, requestsPerSecond: 100 },
    snapshot: null,
    startedAt: null,
    completedAt: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
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
      generated: 100,
      completed: 95,
      failed: 5,
      retries: 0,
      inFlight: 0,
      queued: 0,
      successRate: 0.95,
      errorRate: 0.05,
      failedByReason: {},
    },
    failures: { total: 5, byReason: {}, byNode: {} },
    network: {
      transmissions: 95,
      packetLosses: 0,
      packetLossRate: 0,
      totalLatencyMs: 1000,
    },
    latency: {
      endToEnd: {
        count: 1,
        avgMs: 10,
        p50Ms: 8,
        p95Ms: 20,
        p99Ms: 40,
        minMs: 1,
        maxMs: 50,
      },
      failed: {
        count: 1,
        avgMs: 10,
        p50Ms: 8,
        p95Ms: 20,
        p99Ms: 40,
        minMs: 1,
        maxMs: 50,
      },
      network: {
        count: 1,
        avgMs: 10,
        p50Ms: 8,
        p95Ms: 20,
        p99Ms: 40,
        minMs: 1,
        maxMs: 50,
      },
    },
    components: {},
  };
}

const INPUT: CreateSimulationInput = {
  architectureId: "arch-1",
  sourceNodeId: "src",
  config: { durationMs: 60000, requestsPerSecond: 100 },
};

describe("createSimulation lifecycle", () => {
  it("tracks submitting and records the created run", () => {
    const pending = reducer(INITIAL, createSimulation.pending("req1", INPUT));
    expect(pending.submitting).toBe(true);
    expect(pending.createError).toBeNull();

    const fulfilled = reducer(
      pending,
      createSimulation.fulfilled(makeDetails(), "req1", INPUT),
    );
    expect(fulfilled.submitting).toBe(false);
    expect(fulfilled.runs["sim-1"].status).toBe("created");
    expect(fulfilled.runs["sim-1"].durationMs).toBe(60000);
    expect(fulfilled.latestByArchitecture["arch-1"]).toBe("sim-1");
  });

  it("surfaces a create error on rejection", () => {
    const rejected = reducer(
      INITIAL,
      createSimulation.rejected(
        new Error("boom"),
        "req1",
        INPUT,
        "Routing strategy not configured",
      ),
    );
    expect(rejected.submitting).toBe(false);
    expect(rejected.createError).toBe("Routing strategy not configured");
  });

  it("clears the create error", () => {
    const errored = reducer(
      INITIAL,
      createSimulation.rejected(new Error("boom"), "req1", INPUT, "nope"),
    );
    const cleared = reducer(errored, clearCreateError());
    expect(cleared.createError).toBeNull();
  });
});

describe("startSimulation lifecycle", () => {
  it("marks pending then applies the returned details", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(makeDetails(), "req1", INPUT),
    );

    const pending = reducer(
      seeded,
      startSimulation.pending("req2", "sim-1"),
    );
    expect(pending.runs["sim-1"].pending).toBe(true);

    const fulfilled = reducer(
      pending,
      startSimulation.fulfilled(
        makeDetails({ status: "running", startedAt: "now" }),
        "req2",
        "sim-1",
      ),
    );
    expect(fulfilled.runs["sim-1"].pending).toBe(false);
    expect(fulfilled.runs["sim-1"].status).toBe("running");
    expect(fulfilled.runs["sim-1"].startedAt).toBe("now");
  });

  it("records an action error on rejection", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(makeDetails(), "req1", INPUT),
    );
    const rejected = reducer(
      seeded,
      startSimulation.rejected(
        new Error("x"),
        "req2",
        "sim-1",
        "Cannot start a completed simulation",
      ),
    );
    expect(rejected.runs["sim-1"].pending).toBe(false);
    expect(rejected.runs["sim-1"].actionError).toBe(
      "Cannot start a completed simulation",
    );
  });
});

describe("refreshSimulationStatus", () => {
  it("merges status view into an existing run", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(makeDetails(), "req1", INPUT),
    );
    const refreshed = reducer(
      seeded,
      refreshSimulationStatus.fulfilled(
        {
          id: "sim-1",
          status: "running",
          currentTimeMs: 12000,
          durationMs: 60000,
          startedAt: "t0",
          completedAt: null,
          error: null,
        },
        "req3",
        "sim-1",
      ),
    );
    expect(refreshed.runs["sim-1"].status).toBe("running");
    expect(refreshed.runs["sim-1"].currentTimeMs).toBe(12000);
    expect(refreshed.runs["sim-1"].durationMs).toBe(60000);
  });
});

describe("fetchSimulationMetrics", () => {
  it("attaches a live snapshot to the run without touching results", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(
        makeDetails({ status: "running" }),
        "req1",
        INPUT,
      ),
    );
    const live = reducer(
      seeded,
      fetchSimulationMetrics.fulfilled(makeMetrics(), "req2", "sim-1"),
    );
    expect(live.runs["sim-1"].liveMetrics?.requests.completed).toBe(95);
    expect(live.runs["sim-1"].results).toBeNull();
  });

  it("ignores a null snapshot (transient fetch failure)", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(
        makeDetails({ status: "running" }),
        "req1",
        INPUT,
      ),
    );
    const live = reducer(
      seeded,
      fetchSimulationMetrics.fulfilled(null, "req2", "sim-1"),
    );
    expect(live.runs["sim-1"].liveMetrics).toBeNull();
  });

  it("is cleared once the aggregate results arrive", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(
        makeDetails({ status: "running" }),
        "req1",
        INPUT,
      ),
    );
    const withLive = reducer(
      seeded,
      fetchSimulationMetrics.fulfilled(makeMetrics(), "req2", "sim-1"),
    );
    const completed = reducer(
      withLive,
      fetchSimulationResults.fulfilled(
        {
          simulation: makeDetails({ status: "completed", currentTimeMs: 60000 }),
          metrics: makeMetrics(),
        },
        "req3",
        "sim-1",
      ),
    );
    expect(completed.runs["sim-1"].liveMetrics).toBeNull();
    expect(completed.runs["sim-1"].results?.requests.completed).toBe(95);
  });
});

describe("fetchSimulationResults", () => {
  it("attaches metrics to the run", () => {
    const seeded = reducer(
      INITIAL,
      createSimulation.fulfilled(makeDetails(), "req1", INPUT),
    );
    const withResults = reducer(
      seeded,
      fetchSimulationResults.fulfilled(
        {
          simulation: makeDetails({ status: "completed", currentTimeMs: 60000 }),
          metrics: makeMetrics(),
        },
        "req4",
        "sim-1",
      ),
    );
    expect(withResults.runs["sim-1"].status).toBe("completed");
    expect(withResults.runs["sim-1"].results?.requests.completed).toBe(95);
  });
});
