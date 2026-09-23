import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { TrafficGenerator } from "@/simulation-engine/initializers/traffic-generator.js";
import { FailureScheduler } from "@/simulation-engine/initializers/failure-scheduler.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "@/simulation-engine/autoscaling/autoscaling-scheduler.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { ArchitectureNode } from "@/domain/architecture/component.types.js";
import { describe, expect, it, vi } from "vitest";

function node(
  id: string,
  type: ArchitectureNode["type"],
  config: ArchitectureNode["config"] = {},
): ArchitectureNode {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    config,
  };
}

function createGraph(): ArchitectureGraph {
  return {
    nodes: [
      {
        id: "client",
        type: "client",
        name: "Client",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "api",
        type: "api",
        name: "API",
        position: { x: 100, y: 0 },
        config: {},
      },
      {
        id: "database",
        type: "database",
        name: "Database",
        position: { x: 200, y: 0 },
        config: {},
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "client",
        target: "api",
        config: { latencyMs: 10 },
      },
      {
        id: "edge-2",
        source: "api",
        target: "database",
        config: { latencyMs: 10 },
      },
    ],
  };
}

function createSimulation(
  graph: ArchitectureGraph = createGraph(),
  seed: number = 42,
): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    currentTimeMs: 0,
    seed,
    architectureSnapshot: graph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createEvent(
  type: SimulationEvent["type"],
  timestampMs: number,
  requestId: string,
  sourceNodeId: string,
  targetNodeId?: string,
  id = "event-1",
): SimulationEvent {
  return {
    id,
    simulationId: "simulation-1",
    timestampMs,
    type,
    sourceNodeId,
    targetNodeId,
    payload: { requestId },
  };
}

function createRuntime(
  graph: ArchitectureGraph = createGraph(),
  seed: number = 42,
) {
  const runtime = new SimulationRuntime(createSimulation(graph, seed));
  const processor = new DefaultEventProcessor(
    runtime,
    new AutoscalingController(runtime),
    new AutoscalingScheduler(runtime),
  );

  return { runtime, processor };
}

/**
 * Skips observability events (such as component.health_changed) that can
 * precede a request event at the same timestamp and returns the next event
 * of the requested type, or undefined when none is queued.
 */
function dequeueEventOfType(
  runtime: SimulationRuntime,
  type: SimulationEvent["type"],
): SimulationEvent | undefined {
  while (!runtime.eventQueue.isEmpty()) {
    const event = runtime.eventQueue.dequeue();

    if (event.type === type) {
      return event;
    }
  }

  return undefined;
}

describe("DefaultEventProcessor", () => {
  it("should validate the pre-existing request and schedule its first route on request.created", () => {
    const { runtime, processor } = createRuntime();

    // The request is created by the traffic generator before the event fires.
    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
    });

    processor.process(createEvent("request.created", 0, "req-1", "client"));

    expect(runtime.currentTimeMs).toBe(0);

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.routed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.sourceNodeId).toBe("client");
    expect(scheduled?.targetNodeId).toBe("api");
    expect(scheduled?.payload?.requestId).toBe("req-1");

    // Only the current node is recorded; the request is not re-created.
    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("pending");
    expect(request.createdAtMs).toBe(0);
    expect(request.currentNodeId).toBe("client");
  });

  it("should throw when the request does not yet exist on request.created", () => {
    const { processor } = createRuntime();

    // No createRequest: the traffic generator owns request creation.
    expect(() =>
      processor.process(createEvent("request.created", 0, "req-1", "client")),
    ).toThrowError("Request not found req-1");
  });

  it("should mark a request in-flight and schedule processing on request.routed", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
    });

    processor.process(
      createEvent("request.routed", 10, "req-1", "client", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.processing_started");
    // Processing begins as soon as the request arrives — no extra latency.
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.sourceNodeId).toBe("api");
    expect(scheduled?.targetNodeId).toBe("api");
    expect(scheduled?.payload?.requestId).toBe("req-1");

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("in-flight");
    expect(request.currentNodeId).toBe("api");
  });

  it("should apply the default network latency when the edge has no latency", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api")],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
    });

    processor.process(createEvent("request.created", 0, "req-1", "client"));

    const scheduled = runtime.eventQueue.dequeue();

    // Edge client->api has no latency configured, so the 10ms default applies.
    expect(scheduled?.type).toBe("request.routed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.targetNodeId).toBe("api");
  });

  it("should apply network latency after processing completes on the next hop", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 50 }),
        node("database", "database"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "client",
          target: "api",
          config: { latencyMs: 20 },
        },
        {
          id: "edge-2",
          source: "api",
          target: "database",
          config: { latencyMs: 40 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.incrementActiveRequests("api");

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    const completed = createEvent(
      "request.processing_completed",
      30,
      "req-1",
      "api",
    );
    completed.payload = { requestId: "req-1", processingStartedAtMs: 10 };

    processor.process(completed);

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.routed");
    // Processing completed at 30ms; edge api->database latency is 40ms.
    expect(scheduled?.timestampMs).toBe(70);
    expect(scheduled?.sourceNodeId).toBe("api");
    expect(scheduled?.targetNodeId).toBe("database");

    const component = runtime.getComponent("api");

    expect(component.activeRequests).toBe(0);
    expect(component.processedRequests).toBe(1);
  });

  it("should mark a request completed on request.completed", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "database",
    });

    processor.process(
      createEvent("request.completed", 30, "req-1", "database", "database"),
    );

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("completed");
    expect(request.completedAtMs).toBe(30);
  });

  it("should schedule processing_completed after latency on a healthy component", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api", { latencyMs: 50 })],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    const scheduled = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(scheduled?.type).toBe("request.processing_completed");
    expect(scheduled?.timestampMs).toBe(60);
    expect(scheduled?.payload?.requestId).toBe("req-1");

    expect(runtime.getComponent("api").activeRequests).toBe(1);
  });

  it("should queue a request when the component capacity is exceeded", () => {
    // Capacity is determined by effective concurrency (replicas * concurrency).
    // With default replicas of 1 and concurrency of 1, a component handles a
    // single request at a time.
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api", { concurrency: 1 })],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.incrementActiveRequests("api");

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    // The request was admitted to the queue: a queue.enqueue event is
    // scheduled and the request transitions to the queued state.
    const scheduled = dequeueEventOfType(runtime, "queue.enqueue");

    expect(scheduled?.type).toBe("queue.enqueue");
    expect(scheduled?.sourceNodeId).toBe("api");
    expect(scheduled?.payload?.requestId).toBe("req-1");

    const request = runtime.getRequest("req-1");
    expect(request.status).toBe("queued");
    expect(request.currentNodeId).toBe("api");

    expect(runtime.getQueuedRequestCount("api")).toBe(1);

    // The queue did not consume capacity, so the active count is unchanged.
    expect(runtime.getComponent("api").activeRequests).toBe(1);
  });

  describe("capacity lifecycle", () => {
    it("should accept one of two simultaneous requests and queue the second at capacity 1", () => {
      // A terminal node (no outgoing edges) keeps the lifecycle self-contained:
      // processing_completed decrements the active count and immediately
      // completes the request, so no routing assertions are needed.
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", { concurrency: 1 }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      runtime.createRequest({
        id: "req-2",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      // First request acquires the single slot.
      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      expect(runtime.getComponent("api").activeRequests).toBe(1);

      // Second simultaneous request is queued: capacity never exceeds 1.
      processor.process(
        createEvent("request.processing_started", 10, "req-2", "api"),
      );

      expect(runtime.getQueuedRequestCount("api")).toBe(1);
      expect(runtime.getComponent("api").activeRequests).toBe(1);
    });

    it("should release the slot on processing_completed and dequeue the next request", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", { concurrency: 1 }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      runtime.createRequest({
        id: "req-3",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      // First request acquires the slot.
      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      const completed = dequeueEventOfType(
        runtime,
        "request.processing_completed",
      );

      // Second request is queued while the slot is held.
      processor.process(
        createEvent("request.processing_started", 10, "req-3", "api"),
      );

      expect(runtime.getQueuedRequestCount("api")).toBe(1);

      // Completing the first request decrements the active count and releases
      // the slot, scheduling a drain of the queued requests.
      processor.process({ ...completed });

      expect(runtime.getComponent("api").activeRequests).toBe(0);

      // Processing the drain starts the queued request.
      const drain = dequeueEventOfType(runtime, "queue.drain");
      expect(drain?.type).toBe("queue.drain");
      processor.process({ ...drain });

      // The queued request was scheduled for processing.
      const nextProcessing = dequeueEventOfType(
        runtime,
        "request.processing_started",
      );

      expect(nextProcessing?.type).toBe("request.processing_started");
      expect(nextProcessing?.payload?.requestId).toBe("req-3");
    });
  });

  describe("queue admission & backpressure", () => {
    it("should reject a request when the queue is disabled", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", {
            concurrency: 1,
            queue: { enabled: false },
          }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.incrementActiveRequests("api");

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      const failed = dequeueEventOfType(runtime, "request.failed");

      expect(failed).toMatchObject({
        type: "request.failed",
        payload: { requestId: "req-1", reason: "queue_disabled" },
      });

      expect(runtime.getQueuedRequestCount("api")).toBe(0);
    });

    it("should reject the newest request with queue_overflow when the queue is full (reject strategy)", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", {
            concurrency: 1,
            queue: { maxSize: 1 },
          }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.incrementActiveRequests("api");

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      runtime.createRequest({
        id: "req-2",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      // req-1 fills the single queue slot.
      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      expect(runtime.getQueuedRequestCount("api")).toBe(1);

      // req-2 is rejected: the queue is full and the default strategy is reject.
      processor.process(
        createEvent("request.processing_started", 10, "req-2", "api"),
      );

      const failed = dequeueEventOfType(runtime, "request.failed");

      expect(failed).toMatchObject({
        type: "request.failed",
        payload: { requestId: "req-2", reason: "queue_overflow" },
      });

      processor.process({ ...failed });

      expect(runtime.getRequest("req-2").status).toBe("failed");

      // The queued request is undisturbed.
      expect(runtime.getQueuedRequestCount("api")).toBe(1);
      expect(runtime.dequeueRequest("api")).toBe("req-1");
    });

    it("should evict the oldest queued request with drop_oldest when the queue is full", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", {
            concurrency: 1,
            queue: { maxSize: 1, overflowStrategy: "drop_oldest" },
          }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.incrementActiveRequests("api");

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      runtime.createRequest({
        id: "req-2",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      expect(runtime.getQueuedRequestCount("api")).toBe(1);

      // req-2 evicts req-1 from the full queue.
      processor.process(
        createEvent("request.processing_started", 10, "req-2", "api"),
      );

      // The evicted request fails with queue_overflow.
      const failed = dequeueEventOfType(runtime, "request.failed");

      expect(failed).toMatchObject({
        type: "request.failed",
        payload: { requestId: "req-1", reason: "queue_overflow" },
      });

      processor.process({ ...failed });

      expect(runtime.getRequest("req-1").status).toBe("failed");

      // req-2 now occupies the queue and was never started directly.
      expect(runtime.getQueuedRequestCount("api")).toBe(1);
      expect(runtime.getRequest("req-2").status).toBe("queued");
      expect(runtime.dequeueRequest("api")).toBe("req-2");
    });

    it("should drain the queue on processing_completed and start queued requests in FIFO order", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", {
            concurrency: 1,
            queue: { maxSize: 2 },
          }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      runtime.createRequest({
        id: "req-2",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      runtime.createRequest({
        id: "req-3",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      // req-1 takes the slot; req-2 and req-3 queue behind it.
      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      processor.process(
        createEvent("request.processing_started", 10, "req-2", "api"),
      );

      processor.process(
        createEvent("request.processing_started", 10, "req-3", "api"),
      );

      expect(runtime.getQueuedRequestCount("api")).toBe(2);

      const completed = dequeueEventOfType(
        runtime,
        "request.processing_completed",
      );

      processor.process({ ...completed });

      // The freed slot is offered to the queue through a single drain event.
      const drain = dequeueEventOfType(runtime, "queue.drain");

      expect(drain?.type).toBe("queue.drain");
      expect(drain?.sourceNodeId).toBe("api");

      processor.process({ ...drain });

      // Only the single freed slot is filled: req-2 starts, req-3 waits.
      const started = dequeueEventOfType(runtime, "request.processing_started");

      expect(started?.type).toBe("request.processing_started");
      expect(started?.payload?.requestId).toBe("req-2");

      expect(runtime.getQueuedRequestCount("api")).toBe(1);
    });

    it("should drain only up to the available capacity", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", {
            concurrency: 1,
            queue: { maxSize: 10 },
          }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      // Seed the queue directly; capacity 1 means only one can start.
      runtime.enqueueRequest("api", "req-1");
      runtime.enqueueRequest("api", "req-2");
      runtime.enqueueRequest("api", "req-3");

      expect(runtime.getQueuedRequestCount("api")).toBe(3);

      processor.process(createEvent("queue.drain", 20, "req-1", "api"));

      const started = dequeueEventOfType(runtime, "request.processing_started");

      expect(started?.payload?.requestId).toBe("req-1");

      // Two requests remain queued behind the started one.
      expect(runtime.getQueuedRequestCount("api")).toBe(2);
    });

    it("should not schedule queue.drain on processing_completed when nothing is queued", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("client", "client"), node("api", "api", { latencyMs: 0 })],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      const completed = dequeueEventOfType(
        runtime,
        "request.processing_completed",
      );

      processor.process({ ...completed });

      let drainScheduled = false;

      while (!runtime.eventQueue.isEmpty()) {
        const event = runtime.eventQueue.dequeue();

        if (event.type === "queue.drain") {
          drainScheduled = true;
        }
      }

      expect(drainScheduled).toBe(false);
    });

    it("should not drain a queue when the component is failed", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", { concurrency: 1 }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.enqueueRequest("api", "req-1");

      processor.process(createEvent("component.failed", 10, "req-1", "api"));
      processor.process(createEvent("queue.drain", 20, "req-1", "api"));

      expect(runtime.getQueuedRequestCount("api")).toBe(1);
    });
  });

  describe("component failure lifecycle", () => {
    it("should mark a component as failed on component.failed", () => {
      const { runtime, processor } = createRuntime();

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      expect(runtime.getComponent("api").health).toBe("failed");
    });

    it("should restore a component to healthy on component.recovered", () => {
      const { runtime, processor } = createRuntime();

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      expect(runtime.getComponent("api").health).toBe("failed");

      processor.process(createEvent("component.recovered", 20, "req-1", "api"));

      expect(runtime.getComponent("api").health).toBe("healthy");
    });

    it("should throw when component.failed has no sourceNodeId", () => {
      const { processor } = createRuntime();

      const event = createEvent("component.failed", 10, "req-1", "api");
      event.sourceNodeId = undefined;

      expect(() => processor.process(event)).toThrow(
        "component.failed event requires a sourceNodeId.",
      );
    });

    it("should throw when component.recovered has no sourceNodeId", () => {
      const { processor } = createRuntime();

      const event = createEvent("component.recovered", 10, "req-1", "api");
      event.sourceNodeId = undefined;

      expect(() => processor.process(event)).toThrow(
        "component.recovered event requires a sourceNodeId.",
      );
    });

    it("should fail a request processed while the component is failed", () => {
      const { runtime, processor } = createRuntime();

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      const scheduled = dequeueEventOfType(runtime, "request.failed");

      expect(scheduled?.type).toBe("request.failed");
      expect(scheduled?.timestampMs).toBe(10);
      expect(scheduled?.payload?.reason).toBe("component_failed");
    });

    it("should process requests normally again after the component recovers", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", { latencyMs: 50 }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      processor.process(createEvent("component.recovered", 20, "req-1", "api"));

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 30, "req-1", "api"),
      );

      const scheduled = dequeueEventOfType(
        runtime,
        "request.processing_completed",
      );

      expect(scheduled?.type).toBe("request.processing_completed");
      expect(scheduled?.timestampMs).toBe(80);
      expect(runtime.getComponent("api").activeRequests).toBe(1);
    });
  });

  describe("automatic recovery", () => {
    it("should change health to failed and schedule recovery on failure", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("api", "api", { recoveryDelayMs: 30 })],
        edges: [],
      };

      const { runtime, processor } = createRuntime(graph);

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      expect(runtime.getComponent("api").health).toBe("failed");

      const scheduled = dequeueEventOfType(
        runtime,
        "component.recovery_scheduled",
      );

      expect(scheduled).toMatchObject({
        type: "component.recovery_scheduled",
        sourceNodeId: "api",
        timestampMs: 40,
        payload: { recoveryGeneration: 1, recoveryAtMs: 40 },
      });

      const recovery = dequeueEventOfType(runtime, "component.recovery");

      expect(recovery).toMatchObject({
        type: "component.recovery",
        sourceNodeId: "api",
        timestampMs: 40,
        payload: { recoveryGeneration: 1 },
      });
    });

    it("should not schedule recovery when recoveryDelayMs is omitted", () => {
      const { runtime, processor } = createRuntime();

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      expect(runtime.getComponent("api").health).toBe("failed");

      let recoveryScheduled = false;

      while (!runtime.eventQueue.isEmpty()) {
        const event = runtime.eventQueue.dequeue();

        if (
          event.type === "component.recovery" ||
          event.type === "component.recovery_scheduled"
        ) {
          recoveryScheduled = true;
        }
      }

      expect(recoveryScheduled).toBe(false);
    });

    it("should schedule recovery at the failure timestamp plus the delay", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("api", "api", { recoveryDelayMs: 50 })],
        edges: [],
      };

      const { runtime, processor } = createRuntime(graph);

      processor.process(createEvent("component.failed", 12, "req-1", "api"));

      const scheduled = dequeueEventOfType(
        runtime,
        "component.recovery_scheduled",
      );

      expect(scheduled?.timestampMs).toBe(62);
      expect(scheduled?.payload).toMatchObject({
        recoveryAtMs: 62,
        recoveryGeneration: 1,
      });

      const recovery = dequeueEventOfType(runtime, "component.recovery");

      expect(recovery?.timestampMs).toBe(62);
    });

    it("should ignore a stale recovery event from an older generation", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("api", "api", { recoveryDelayMs: 30 })],
        edges: [],
      };

      const { runtime, processor } = createRuntime(graph);

      // First failure → generation 1, automatic recovery scheduled at t=40.
      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      // The component is manually recovered before the automatic recovery fires.
      processor.process(createEvent("component.recovered", 20, "req-1", "api"));

      // Failure again → generation 2, automatic recovery scheduled at t=60.
      processor.process(createEvent("component.failed", 30, "req-1", "api"));

      // The stale recovery event (generation 1, t=40) must be ignored.
      const staleRecovery = createEvent(
        "component.recovery",
        40,
        "req-1",
        "api",
      );
      staleRecovery.payload = { recoveryGeneration: 1 };

      processor.process(staleRecovery);

      expect(runtime.getComponent("api").health).toBe("failed");

      // No component.recovered was scheduled by the stale event.
      let recoveredScheduled = false;

      while (!runtime.eventQueue.isEmpty()) {
        const event = runtime.eventQueue.dequeue();

        if (event.type === "component.recovered") {
          recoveredScheduled = true;
        }
      }

      expect(recoveredScheduled).toBe(false);
    });

    it("should recover a failed component when the generation matches", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("api", "api", { recoveryDelayMs: 30 })],
        edges: [],
      };

      const { runtime, processor } = createRuntime(graph);

      processor.process(createEvent("component.failed", 10, "req-1", "api"));

      expect(runtime.getComponent("api").health).toBe("failed");

      // The automatic recovery event fires and schedules component.recovered.
      const recovery = dequeueEventOfType(runtime, "component.recovery");

      processor.process(recovery!);

      const recovered = dequeueEventOfType(runtime, "component.recovered");

      expect(recovered).toMatchObject({
        type: "component.recovered",
        sourceNodeId: "api",
        timestampMs: 40,
      });

      processor.process(recovered!);

      expect(runtime.getComponent("api").health).toBe("healthy");
    });
  });

  describe("health evaluation", () => {
    it("should record processing attempts and latency for a successful request", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", { latencyMs: 50, concurrency: 10 }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      const completed = runtime.eventQueue.dequeue();

      expect(completed?.payload?.processingStartedAtMs).toBe(10);

      processor.process(completed!);

      const component = runtime.getComponent("api");

      expect(component.totalProcessingAttempts).toBe(1);
      expect(component.failedProcessingAttempts).toBe(0);
      expect(component.totalProcessingLatencyMs).toBe(50);
      expect(component.lastProcessingLatencyMs).toBe(50);
      expect(component.processedRequests).toBe(1);
    });

    it("should record a failed processing attempt when the component errors", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("client", "client"), node("api", "api", { errorRate: 1 })],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      const scheduled = runtime.eventQueue.dequeue();

      expect(scheduled?.type).toBe("request.failed");

      const component = runtime.getComponent("api");

      expect(component.totalProcessingAttempts).toBe(1);
      expect(component.failedProcessingAttempts).toBe(1);
    });

    it("should mark a component critical on high utilization and healthy after completion", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("client", "client"), node("api", "api")],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      // Default effective concurrency is 1, so the single active request
      // pushes utilization to 1.0 → critical (≥ 0.9).
      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      expect(runtime.getComponent("api").health).toBe("critical");

      // Completing the request frees the slot → utilization 0 → healthy again.
      const completed = dequeueEventOfType(
        runtime,
        "request.processing_completed",
      );
      processor.process(completed!);

      expect(runtime.getComponent("api").health).toBe("healthy");
    });

    it("should mark a component degraded when its average latency crosses a configured threshold", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("client", "client"),
          node("api", "api", {
            latencyMs: 250,
            concurrency: 10,
            healthThresholds: {
              utilization: { degraded: 0.7, critical: 0.9 },
              errorRate: { degraded: 0.05, critical: 0.2 },
              latencyMs: { degraded: 200, critical: 500 },
            },
          }),
        ],
        edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      // Low utilization keeps the component healthy before any request completes.
      processor.process(
        createEvent("request.processing_started", 10, "req-1", "api"),
      );

      expect(runtime.getComponent("api").health).toBe("healthy");

      // Average latency is now 250ms ≥ degraded (200) → degraded.
      const completed = runtime.eventQueue.dequeue();
      processor.process(completed!);

      expect(runtime.getComponent("api").health).toBe("degraded");
    });

    it("should throw when processing_completed lacks processingStartedAtMs", () => {
      const { runtime, processor } = createRuntime();

      runtime.createRequest({
        id: "req-1",
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });

      const event = createEvent(
        "request.processing_completed",
        30,
        "req-1",
        "api",
      );

      expect(() => processor.process(event)).toThrow(
        "request.processing_completed event requires processingStartedAtMs.",
      );
    });
  });

  it("should fail a request when the component has failed", () => {
    const { runtime, processor } = createRuntime();

    runtime.updateComponent("api", { health: "failed" });

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.failed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.payload?.reason).toBe("component_failed");
  });

  it("should always succeed when errorRate is 0", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api", { errorRate: 0 })],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    const scheduled = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(scheduled?.type).toBe("request.processing_completed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.payload?.requestId).toBe("req-1");

    expect(runtime.getComponent("api").activeRequests).toBe(1);
  });

  it("should always fail when errorRate is 1", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api", { errorRate: 1 })],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.failed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.payload?.reason).toBe("component_error");

    // The request was rejected, so the component's active count is unchanged.
    expect(runtime.getComponent("api").activeRequests).toBe(0);
  });

  it("should mark a request as failed on request.failed", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(createEvent("request.failed", 25, "req-1", "api", "api"));

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("failed");
    expect(request.failedAtMs).toBe(25);
  });

  it("should produce deterministic success/failure sequences for the same seed and error rate", () => {
    // A high concurrency keeps the trace focused on error-rate determinism:
    // each successful attempt leaves one active request behind (its
    // processing_completed is never drained here), and the default effective
    // concurrency of 1 would otherwise cap the trace at a single success.
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { errorRate: 0.5, concurrency: 10 }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runTrace = (seed: number): string[] => {
      const { runtime, processor } = createRuntime(graph, seed);

      const outcomes: string[] = [];

      for (let i = 0; i < 5; i++) {
        const requestId = `req-${i}`;

        runtime.createRequest({
          id: requestId,
          status: "in-flight",
          createdAtMs: 0,
          attempts: 0,
          currentNodeId: "api",
        });

        processor.process(
          createEvent("request.processing_started", 10, requestId, "api"),
        );

        const scheduled = dequeueEventOfType(
          runtime,
          "request.processing_completed",
        );

        outcomes.push(scheduled ? "success" : "fail");
      }

      return outcomes;
    };

    const traceA = runTrace(42);
    const traceB = runTrace(42);

    expect(traceA).toEqual(traceB);
    // Expected from the Mulberry32 PRNG with seed 42: both paths execute and
    // the same outcomes recur for identical simulations.
    expect(traceA).toEqual(["success", "fail", "success", "success", "fail"]);
  });

  it("should decrement active requests and complete a request at a terminal node", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("database", "database")],
      edges: [
        { id: "edge-1", source: "client", target: "database", config: {} },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.incrementActiveRequests("database");

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "database",
    });

    const completed = createEvent(
      "request.processing_completed",
      30,
      "req-1",
      "database",
    );
    completed.payload = { requestId: "req-1", processingStartedAtMs: 10 };

    processor.process(completed);

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.completed");
    expect(scheduled?.timestampMs).toBe(30);

    const component = runtime.getComponent("database");

    expect(component.activeRequests).toBe(0);
    expect(component.processedRequests).toBe(1);
  });

  it("should throw when a request.created event lacks a requestId", () => {
    const { processor } = createRuntime();

    const event: SimulationEvent = {
      id: "event-1",
      simulationId: "simulation-1",
      timestampMs: 0,
      type: "request.created",
      sourceNodeId: "client",
    };

    expect(() => processor.process(event)).toThrowError(
      "request.created event requires a requestId.",
    );
  });

  it("should throw when a request.created event lacks a sourceNodeId", () => {
    const { processor } = createRuntime();

    const event: SimulationEvent = {
      id: "event-1",
      simulationId: "simulation-1",
      timestampMs: 0,
      type: "request.created",
      payload: { requestId: "req-1" },
    };

    expect(() => processor.process(event)).toThrowError(
      "request.created event requires a sourceNodeId.",
    );
  });

  it("should throw when a request.routed event lacks a targetNodeId", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
    });

    const event: SimulationEvent = {
      id: "event-1",
      simulationId: "simulation-1",
      timestampMs: 10,
      type: "request.routed",
      sourceNodeId: "client",
      payload: { requestId: "req-1" },
    };

    expect(() => processor.process(event)).toThrowError(
      "request.routed event requires a targetNodeId.",
    );
  });

  it("should round-robin requests across multiple outgoing connections", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("gateway", "load_balancer", { routingStrategy: "round_robin" }),
        node("api-1", "api"),
        node("api-2", "api"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "gateway",
          target: "api-1",
          config: { latencyMs: 0 },
        },
        {
          id: "edge-2",
          source: "gateway",
          target: "api-2",
          config: { latencyMs: 0 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "gateway",
    });
    runtime.createRequest({
      id: "req-2",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "gateway",
    });

    // Route two requests from the gateway; each should take the next edge in
    // round-robin order without a routing policy failure.
    processor.process(createEvent("request.created", 10, "req-1", "gateway"));
    processor.process(createEvent("request.created", 10, "req-2", "gateway"));

    const first = runtime.eventQueue.dequeue();

    expect(first?.type).toBe("request.routed");
    expect(first?.targetNodeId).toBe("api-1");
    expect(first?.timestampMs).toBe(10);

    const second = runtime.eventQueue.dequeue();

    expect(second?.type).toBe("request.routed");
    expect(second?.targetNodeId).toBe("api-2");
    expect(second?.timestampMs).toBe(10);
  });

  it("should keep separate routing state for different source nodes", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("gateway", "load_balancer", { routingStrategy: "round_robin" }),
        node("queue", "queue", { routingStrategy: "round_robin" }),
        node("api-1", "api"),
        node("api-2", "api"),
        node("api-3", "api"),
        node("worker-1", "worker"),
        node("worker-2", "worker"),
        node("worker-3", "worker"),
      ],
      edges: [
        {
          id: "g-1",
          source: "gateway",
          target: "api-1",
          config: { latencyMs: 0 },
        },
        {
          id: "g-2",
          source: "gateway",
          target: "api-2",
          config: { latencyMs: 0 },
        },
        {
          id: "g-3",
          source: "gateway",
          target: "api-3",
          config: { latencyMs: 0 },
        },
        {
          id: "q-1",
          source: "queue",
          target: "worker-1",
          config: { latencyMs: 0 },
        },
        {
          id: "q-2",
          source: "queue",
          target: "worker-2",
          config: { latencyMs: 0 },
        },
        {
          id: "q-3",
          source: "queue",
          target: "worker-3",
          config: { latencyMs: 0 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "gateway",
    });
    runtime.createRequest({
      id: "req-2",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "queue",
    });

    // Gateway routes its first request, then queue routes its first. Their
    // counters must advance independently and not interfere.
    processor.process(createEvent("request.created", 0, "req-1", "gateway"));
    processor.process(createEvent("request.created", 0, "req-2", "queue"));

    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("api-1");
    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("worker-1");

    // Second round: gateway still advances its own position to api-2 while
    // queue stays on its own worker-2.
    processor.process(createEvent("request.created", 0, "req-1", "gateway"));
    processor.process(createEvent("request.created", 0, "req-2", "queue"));

    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("api-2");
    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("worker-2");
  });

  it("should apply each edge's latency when round-robin routing", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("gateway", "load_balancer", { routingStrategy: "round_robin" }),
        node("api-1", "api"),
        node("api-2", "api"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "gateway",
          target: "api-1",
          config: { latencyMs: 5 },
        },
        {
          id: "edge-2",
          source: "gateway",
          target: "api-2",
          config: { latencyMs: 20 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    // Request 1 is routed from the gateway at T=0.
    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "gateway",
    });
    processor.process(createEvent("request.created", 0, "req-1", "gateway"));

    const first = runtime.eventQueue.dequeue();

    expect(first?.type).toBe("request.routed");
    expect(first?.targetNodeId).toBe("api-1");
    expect(first?.timestampMs).toBe(5);

    // Request 2 takes the next edge, whose latency is higher.
    runtime.createRequest({
      id: "req-2",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "gateway",
    });
    processor.process(createEvent("request.created", 0, "req-2", "gateway"));

    const second = runtime.eventQueue.dequeue();

    expect(second?.type).toBe("request.routed");
    expect(second?.targetNodeId).toBe("api-2");
    expect(second?.timestampMs).toBe(20);
  });

  it("should complete a request at a terminal node without invoking routing", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("api", "api"), node("database", "database")],
      edges: [
        {
          id: "edge-1",
          source: "api",
          target: "database",
          config: { latencyMs: 5 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    const getRoutingStrategySpy = vi.spyOn(runtime, "getRoutingStrategy");

    // Route the request to the terminal database node: it starts processing
    // there immediately.
    processor.process(
      createEvent("request.routed", 10, "req-1", "api", "database"),
    );

    const started = runtime.eventQueue.dequeue();

    expect(started?.type).toBe("request.processing_started");
    expect(started?.timestampMs).toBe(10);

    expect(getRoutingStrategySpy).not.toHaveBeenCalled();

    // Processing completes instantly (no latency) and, having no outgoing
    // edges, the database completes the request without consulting routing.
    processor.process(started!);

    const processingCompleted = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(processingCompleted?.type).toBe("request.processing_completed");
    expect(processingCompleted?.timestampMs).toBe(10);

    processor.process(processingCompleted!);

    const completed = dequeueEventOfType(runtime, "request.completed");

    expect(completed?.type).toBe("request.completed");
    expect(completed?.timestampMs).toBe(10);

    expect(getRoutingStrategySpy).not.toHaveBeenCalled();
  });

  it("should route through a load balancer via its random strategy with edge latency", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("lb", "load_balancer", { routingStrategy: "random" }),
        node("api-1", "api"),
        node("api-2", "api"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "lb",
          target: "api-1",
          config: { latencyMs: 5 },
        },
        {
          id: "edge-2",
          source: "lb",
          target: "api-2",
          config: { latencyMs: 15 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "lb",
    });

    // floor(0.6 * 2) = 1 → the second edge (api-2).
    vi.spyOn(runtime.random, "next").mockReturnValue(0.6);

    processor.process(createEvent("request.created", 0, "req-1", "lb"));

    const routed = runtime.eventQueue.dequeue();

    expect(routed).toMatchObject({
      type: "request.routed",
      sourceNodeId: "lb",
      targetNodeId: "api-2",
      timestampMs: 15,
      payload: { requestId: "req-1" },
    });
  });

  it("should route to the least-connected target through a load balancer", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("lb", "load_balancer", {
          routingStrategy: "least_connections",
        }),
        node("api-1", "api"),
        node("api-2", "api"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "lb",
          target: "api-1",
          config: { latencyMs: 5 },
        },
        {
          id: "edge-2",
          source: "lb",
          target: "api-2",
          config: { latencyMs: 15 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    // api-1 is busier than api-2, so the request must head to api-2.
    runtime.incrementActiveRequests("api-1");
    runtime.incrementActiveRequests("api-1");
    runtime.incrementActiveRequests("api-2");

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "lb",
    });

    processor.process(createEvent("request.created", 0, "req-1", "lb"));

    const routed = runtime.eventQueue.dequeue();

    expect(routed).toMatchObject({
      type: "request.routed",
      sourceNodeId: "lb",
      targetNodeId: "api-2",
      timestampMs: 15,
      payload: { requestId: "req-1" },
    });
  });

  describe("health-aware routing", () => {
    function makeRequest(
      runtime: ReturnType<typeof createRuntime>["runtime"],
      processor: ReturnType<typeof createRuntime>["processor"],
      requestId: string,
      sourceNodeId: string,
    ): void {
      runtime.createRequest({
        id: requestId,
        status: "pending",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: sourceNodeId,
      });

      processor.process(
        createEvent("request.created", 0, requestId, sourceNodeId),
      );
    }

    it("should route to a healthy destination", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("lb", "load_balancer"), node("api", "api")],
        edges: [{ id: "edge-1", source: "lb", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      makeRequest(runtime, processor, "req-1", "lb");

      const routed = runtime.eventQueue.dequeue();

      expect(routed).toMatchObject({
        type: "request.routed",
        sourceNodeId: "lb",
        targetNodeId: "api",
        timestampMs: 10,
      });
    });

    it("should route to a degraded destination", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("lb", "load_balancer"), node("api", "api")],
        edges: [{ id: "edge-1", source: "lb", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api", { health: "degraded" });

      makeRequest(runtime, processor, "req-1", "lb");

      const routed = runtime.eventQueue.dequeue();

      expect(routed).toMatchObject({
        type: "request.routed",
        targetNodeId: "api",
      });
    });

    it("should route to a critical destination", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("lb", "load_balancer"), node("api", "api")],
        edges: [{ id: "edge-1", source: "lb", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api", { health: "critical" });

      makeRequest(runtime, processor, "req-1", "lb");

      const routed = runtime.eventQueue.dequeue();

      expect(routed).toMatchObject({
        type: "request.routed",
        targetNodeId: "api",
      });
    });

    it("should exclude a failed destination and route only to available ones", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("lb", "load_balancer", { routingStrategy: "round_robin" }),
          node("api-1", "api"),
          node("api-2", "api"),
        ],
        edges: [
          { id: "edge-1", source: "lb", target: "api-1", config: {} },
          { id: "edge-2", source: "lb", target: "api-2", config: {} },
        ],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api-1", { health: "failed" });

      makeRequest(runtime, processor, "req-1", "lb");
      makeRequest(runtime, processor, "req-2", "lb");

      const first = runtime.eventQueue.dequeue();
      const second = runtime.eventQueue.dequeue();

      // The failed api-1 is never considered: round robin over a single
      // available candidate keeps sending to api-2.
      expect(first).toMatchObject({
        type: "request.routed",
        targetNodeId: "api-2",
      });
      expect(second).toMatchObject({
        type: "request.routed",
        targetNodeId: "api-2",
      });
    });

    it("should fail the request when every destination is failed", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("lb", "load_balancer", { routingStrategy: "round_robin" }),
          node("api-1", "api"),
          node("api-2", "api"),
        ],
        edges: [
          { id: "edge-1", source: "lb", target: "api-1", config: {} },
          { id: "edge-2", source: "lb", target: "api-2", config: {} },
        ],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api-1", { health: "failed" });
      runtime.updateComponent("api-2", { health: "failed" });

      makeRequest(runtime, processor, "req-1", "lb");

      const failed = runtime.eventQueue.dequeue();

      expect(failed).toMatchObject({
        type: "request.failed",
        sourceNodeId: "lb",
        timestampMs: 0,
        payload: {
          requestId: "req-1",
          reason: "no_available_destination",
        },
      });
    });

    it("should route to a destination again after it recovers", () => {
      const graph: ArchitectureGraph = {
        nodes: [node("lb", "load_balancer"), node("api", "api")],
        edges: [{ id: "edge-1", source: "lb", target: "api", config: {} }],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api", { health: "failed" });

      // While failed, the single destination is unavailable.
      makeRequest(runtime, processor, "req-1", "lb");

      expect(runtime.eventQueue.dequeue()).toMatchObject({
        type: "request.failed",
        payload: { reason: "no_available_destination" },
      });

      processor.process(createEvent("component.recovered", 0, "req-1", "api"));

      // After recovery the destination is routable again.
      makeRequest(runtime, processor, "req-2", "lb");

      expect(dequeueEventOfType(runtime, "request.routed")).toMatchObject({
        type: "request.routed",
        targetNodeId: "api",
      });
    });

    it("should still complete requests at a terminal node with no outgoing edges", () => {
      // A failed terminal node is not availability-filtered: with zero
      // outgoing edges the request completes rather than failing.
      const graph: ArchitectureGraph = {
        nodes: [node("client", "client"), node("database", "database")],
        edges: [
          { id: "edge-1", source: "client", target: "database", config: {} },
        ],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("database", { health: "failed" });

      makeRequest(runtime, processor, "req-1", "database");

      expect(runtime.eventQueue.dequeue()).toMatchObject({
        type: "request.completed",
        sourceNodeId: "database",
        timestampMs: 0,
      });
    });

    it("should run round robin across the filtered candidates", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("lb", "load_balancer", { routingStrategy: "round_robin" }),
          node("api-1", "api"),
          node("api-2", "api"),
          node("api-3", "api"),
        ],
        edges: [
          { id: "edge-1", source: "lb", target: "api-1", config: {} },
          { id: "edge-2", source: "lb", target: "api-2", config: {} },
          { id: "edge-3", source: "lb", target: "api-3", config: {} },
        ],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api-2", { health: "failed" });

      makeRequest(runtime, processor, "req-1", "lb");
      makeRequest(runtime, processor, "req-2", "lb");

      const first = runtime.eventQueue.dequeue();
      const second = runtime.eventQueue.dequeue();

      // Cycle over [api-1, api-3] only: the failed api-2 is skipped.
      expect(first).toMatchObject({
        type: "request.routed",
        targetNodeId: "api-1",
      });
      expect(second).toMatchObject({
        type: "request.routed",
        targetNodeId: "api-3",
      });
    });

    it("should run random across the filtered candidates", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("lb", "load_balancer", { routingStrategy: "random" }),
          node("api-1", "api"),
          node("api-2", "api"),
          node("api-3", "api"),
        ],
        edges: [
          { id: "edge-1", source: "lb", target: "api-1", config: {} },
          { id: "edge-2", source: "lb", target: "api-2", config: {} },
          { id: "edge-3", source: "lb", target: "api-3", config: {} },
        ],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api-2", { health: "failed" });

      // floor(0.9 * 2) = 1 → the second of [api-1, api-3] → api-3.
      vi.spyOn(runtime.random, "next").mockReturnValue(0.9);

      makeRequest(runtime, processor, "req-1", "lb");

      expect(runtime.eventQueue.dequeue()).toMatchObject({
        type: "request.routed",
        targetNodeId: "api-3",
      });
    });

    it("should run least connections across the filtered candidates", () => {
      const graph: ArchitectureGraph = {
        nodes: [
          node("lb", "load_balancer", {
            routingStrategy: "least_connections",
          }),
          node("api-1", "api"),
          node("api-2", "api"),
          node("api-3", "api"),
        ],
        edges: [
          { id: "edge-1", source: "lb", target: "api-1", config: {} },
          { id: "edge-2", source: "lb", target: "api-2", config: {} },
          { id: "edge-3", source: "lb", target: "api-3", config: {} },
        ],
      };

      const { runtime, processor } = createRuntime(graph);

      runtime.updateComponent("api-2", { health: "failed" });

      // Among the available [api-1, api-3], api-3 is the least busy.
      runtime.incrementActiveRequests("api-1");
      runtime.incrementActiveRequests("api-1");
      runtime.incrementActiveRequests("api-3");

      makeRequest(runtime, processor, "req-1", "lb");

      expect(runtime.eventQueue.dequeue()).toMatchObject({
        type: "request.routed",
        targetNodeId: "api-3",
      });
    });
  });
});

describe("error rate failure lifecycle", () => {
  it("should schedule request.failed and nothing else when errorRate is 1", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 20, capacity: 10, errorRate: 1 }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled).toMatchObject({
      type: "request.failed",
      payload: {
        requestId: "request-1",
        reason: "component_error",
      },
    });

    // Nothing else was scheduled: no processing_completed, no routing.
    expect(runtime.eventQueue.isEmpty()).toBe(true);

    // A failed request never consumes active capacity.
    expect(runtime.getComponent("api").activeRequests).toBe(0);
  });

  it("should mark the request failed through the full engine lifecycle", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 20, capacity: 10, errorRate: 1 }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    engine.schedule(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    engine.run();

    expect(runtime.getRequest("request-1")).toMatchObject({
      status: "failed",
      failedAtMs: expect.any(Number),
    });

    // The failed request neither routed onwards nor consumed capacity.
    expect(runtime.eventQueue.isEmpty()).toBe(true);
    expect(runtime.getComponent("api").activeRequests).toBe(0);
  });

  it("should keep errorRate 0 requests on the normal path through completion", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 20, errorRate: 0 }),
        node("database", "database"),
      ],
      edges: [
        { id: "edge-1", source: "client", target: "api", config: {} },
        {
          id: "edge-2",
          source: "api",
          target: "database",
          config: { latencyMs: 5 },
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    const completedProcessing = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(completedProcessing).toMatchObject({
      type: "request.processing_completed",
      timestampMs: 30,
      payload: { requestId: "request-1" },
    });

    processor.process(completedProcessing!);

    const routed = dequeueEventOfType(runtime, "request.routed");

    expect(routed?.type).toBe("request.routed");
    expect(routed?.targetNodeId).toBe("database");

    // Arriving at the database starts processing immediately...
    processor.process(routed!);

    const startedDatabase = dequeueEventOfType(
      runtime,
      "request.processing_started",
    );

    expect(startedDatabase).toMatchObject({
      type: "request.processing_started",
      timestampMs: 35,
      sourceNodeId: "database",
    });

    processor.process(startedDatabase!);

    // ...which, with no latency, completes at the same timestamp.
    const completedDatabase = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(completedDatabase).toMatchObject({
      type: "request.processing_completed",
      timestampMs: 35,
    });

    // A terminal node completes the request after processing.
    processor.process(completedDatabase!);

    const completed = dequeueEventOfType(runtime, "request.completed");

    expect(completed?.type).toBe("request.completed");
    expect(completed?.timestampMs).toBe(35);

    processor.process(completed!);

    expect(runtime.getRequest("request-1").status).toBe("completed");
  });

  it("should produce identical success/failure sequences for seed 12345", () => {
    // A high concurrency keeps the trace focused on error-rate determinism:
    // each successful attempt leaves one active request behind (its
    // processing_completed is never drained here), and the default effective
    // concurrency of 1 would otherwise cap the trace at a single success.
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { errorRate: 0.5, concurrency: 10 }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runTrace = (seed: number): string[] => {
      const { runtime, processor } = createRuntime(graph, seed);

      const outcomes: string[] = [];

      for (let i = 0; i < 8; i++) {
        const requestId = `request-${i}`;

        runtime.createRequest({
          id: requestId,
          status: "in-flight",
          createdAtMs: 0,
          attempts: 0,
          currentNodeId: "api",
        });

        processor.process(
          createEvent("request.processing_started", 10, requestId, "api"),
        );

        const scheduled = dequeueEventOfType(
          runtime,
          "request.processing_completed",
        );

        outcomes.push(scheduled ? "SUCCESS" : "FAILURE");
      }

      return outcomes;
    };

    const traceA = runTrace(12345);
    const traceB = runTrace(12345);

    // Two identical simulations with the same seed must produce the
    // same success/failure sequence.
    expect(traceA).toEqual(traceB);
    // Expected from the Mulberry32 PRNG with seed 12345.
    expect(traceA).toEqual([
      "SUCCESS",
      "FAILURE",
      "FAILURE",
      "SUCCESS",
      "SUCCESS",
      "FAILURE",
      "FAILURE",
      "SUCCESS",
    ]);
  });

  it("should retry an error-rate failure and succeed on the retry", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", {
          errorRate: 0.5,
          retryPolicy: { retries: 1, circuitBreaker: false },
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    // First roll fails, the retry roll succeeds.
    vi.spyOn(runtime.random, "next")
      .mockReturnValueOnce(0.4)
      .mockReturnValueOnce(0.6);

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    const retry = runtime.eventQueue.dequeue();

    expect(retry).toMatchObject({
      type: "request.retry",
      timestampMs: 20,
      payload: {
        requestId: "request-1",
      },
    });

    processor.process(retry!);

    const startedAgain = runtime.eventQueue.dequeue();

    expect(startedAgain?.type).toBe("request.processing_started");

    processor.process(startedAgain!);

    const completed = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(completed).toMatchObject({
      type: "request.processing_completed",
      payload: { requestId: "request-1" },
    });

    expect(runtime.getRequest("request-1").attempts).toBe(2);
  });

  it("should fail permanently after exhausting the retry budget", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", {
          errorRate: 0.5,
          retryPolicy: { retries: 1, circuitBreaker: false },
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    // Both the initial attempt and the retry roll fail.
    vi.spyOn(runtime.random, "next").mockReturnValue(0.4);

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    const retry = runtime.eventQueue.dequeue();

    expect(retry?.type).toBe("request.retry");

    processor.process(retry!);

    const startedAgain = runtime.eventQueue.dequeue();

    expect(startedAgain?.type).toBe("request.processing_started");

    processor.process(startedAgain!);

    const failed = runtime.eventQueue.dequeue();

    expect(failed).toMatchObject({
      type: "request.failed",
      payload: {
        requestId: "request-1",
        reason: "component_error",
      },
    });

    // Nothing else was scheduled and the request never consumed capacity.
    expect(runtime.eventQueue.isEmpty()).toBe(true);
    expect(runtime.getComponent("api").activeRequests).toBe(0);
    expect(runtime.getRequest("request-1").attempts).toBe(2);
  });

  it("should not consume capacity when the retry budget is exhausted", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", {
          errorRate: 1,
          retryPolicy: { retries: 2, circuitBreaker: false },
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // Failed attempts must never increment the component's active count.
    const incrementSpy = vi.spyOn(runtime, "incrementActiveRequests");

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    engine.schedule(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    engine.run();

    // retries: 2 allows two retries (attempts 1 and 2); the third failure
    // exhausts the budget and fails the request permanently.
    expect(runtime.getRequest("request-1")).toMatchObject({
      status: "failed",
      attempts: 3,
      failedAtMs: expect.any(Number),
    });

    expect(runtime.getComponent("api").activeRequests).toBe(0);
    expect(runtime.eventQueue.isEmpty()).toBe(true);
    expect(incrementSpy).not.toHaveBeenCalled();
  });

  it("should retry a failing attempt and complete on the retry", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", {
          errorRate: 0.5,
          retryPolicy: { retries: 1, circuitBreaker: false },
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // Attempt 1 fails, the retry succeeds.
    vi.spyOn(runtime.random, "next")
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.9);

    const processed: SimulationEvent["type"][] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      // Observability-only health transitions are not part of the request flow.
      if (event.type !== "component.health_changed") {
        processed.push(event.type);
      }
      originalProcess(event);
    };

    runtime.createRequest({
      id: "request-1",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    engine.schedule(
      createEvent("request.processing_started", 10, "request-1", "api"),
    );

    engine.run();

    expect(processed).toEqual([
      "request.processing_started",
      "request.retry",
      "request.processing_started",
      "request.processing_completed",
      "request.completed",
    ]);

    const request = runtime.getRequest("request-1");

    expect(request.status).toBe("completed");
    expect(request.attempts).toBe(2);

    // Capacity was consumed during processing and released on completion.
    expect(runtime.getComponent("api").activeRequests).toBe(0);
  });
});

describe("SimulationEngine with DefaultEventProcessor", () => {
  it("should process a request through Client → API → Database and complete it", () => {
    // The user-facing pipeline: client --10ms--> api --20ms--> database, with
    // 15ms of processing at api and 5ms at database.
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 15 }),
        node("database", "database", { latencyMs: 5 }),
      ],
      edges: [
        {
          id: "edge-1",
          source: "client",
          target: "api",
          config: { latencyMs: 10 },
        },
        {
          id: "edge-2",
          source: "api",
          target: "database",
          config: { latencyMs: 20 },
        },
      ],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // The traffic generator creates the request before request.created fires.
    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
    });

    const processed: {
      type: SimulationEvent["type"];
      target?: string;
      timestampMs: number;
    }[] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      // Observability-only health transitions are not part of the request flow.
      if (event.type !== "component.health_changed") {
        processed.push({
          type: event.type,
          target: event.targetNodeId,
          timestampMs: event.timestampMs,
        });
      }
      originalProcess(event);
    };

    engine.schedule(createEvent("request.created", 0, "req-1", "client"));

    engine.run();

    expect(processed).toEqual([
      { type: "request.created", target: undefined, timestampMs: 0 },
      { type: "request.routed", target: "api", timestampMs: 10 },
      {
        type: "request.processing_started",
        target: "api",
        timestampMs: 10,
      },
      {
        type: "request.processing_completed",
        target: undefined,
        timestampMs: 25,
      },
      { type: "request.routed", target: "database", timestampMs: 45 },
      {
        type: "request.processing_started",
        target: "database",
        timestampMs: 45,
      },
      {
        type: "request.processing_completed",
        target: undefined,
        timestampMs: 50,
      },
      { type: "request.completed", target: undefined, timestampMs: 50 },
    ]);

    expect(runtime.eventQueue.isEmpty()).toBe(true);

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("completed");
    expect(request.currentNodeId).toBe("database");
    expect(request.createdAtMs).toBe(0);
    expect(request.completedAtMs).toBe(50);
    expect(request.attempts).toBe(2);
    expect(runtime.currentTimeMs).toBe(50);
  });

  it("should complete requests created and processed via initializeTraffic", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api")],
      edges: [
        {
          id: "edge-1",
          source: "client",
          target: "api",
          config: { latencyMs: 10 },
        },
      ],
    };

    // One request arrives at t=0: the arrival interval (1000/50 = 20ms) equals
    // the duration, and the endpoint is exclusive, so exactly one request.created
    // event is emitted — leaving the full 10ms pipeline inside the duration.
    const simulation = createSimulation(graph, 42);
    simulation.config = {
      ...simulation.config,
      requestsPerSecond: 50,
      durationMs: 20,
    };

    const runtime = new SimulationRuntime(simulation);
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // The traffic generator populates the request, and the processor then
    // consumes the request.created event it scheduled — Change 1 end-to-end.
    engine.initializeTraffic("client");
    engine.run();

    expect(runtime.eventQueue.isEmpty()).toBe(true);

    const request = runtime.getRequest("simulation-1:request:0");

    expect(request.status).toBe("completed");
    expect(request.currentNodeId).toBe("api");
    expect(runtime.currentTimeMs).toBe(10);
  });

  it("should traverse single-edge hops without a routing strategy configured", () => {
    // The default graph (client -> api -> database) has exactly one edge per
    // node and no routingStrategy configured anywhere.
    const runtime = new SimulationRuntime(createSimulation());
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    const getRoutingStrategySpy = vi.spyOn(runtime, "getRoutingStrategy");

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
    });

    engine.schedule(createEvent("request.created", 0, "req-1", "client"));
    engine.run();

    expect(runtime.getRequest("req-1").status).toBe("completed");
    // A node with a single outgoing edge picks it directly — no strategy lookup.
    expect(getRoutingStrategySpy).not.toHaveBeenCalled();
  });

  it("should fail requests during a component failure window and recover afterwards", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 5, recoveryDelayMs: 20 }),
        node("database", "database"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "client",
          target: "api",
          config: { latencyMs: 10 },
        },
        {
          id: "edge-2",
          source: "api",
          target: "database",
          config: { latencyMs: 10 },
        },
      ],
    };

    const simulation = createSimulation(graph, 42);
    simulation.config = {
      ...simulation.config,
      // Auto-recovery kicks in 20ms after the failure at t=20 → t=40.
      failures: [{ nodeId: "api", failedAtMs: 20 }],
    };

    const runtime = new SimulationRuntime(simulation);
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    engine.initializeFailures();

    // req-1 completes through api before the failure; req-2 is routed into api
    // during the failure window; req-3 arrives after api has recovered.
    for (const request of [
      { id: "req-1", createdAtMs: 0 },
      { id: "req-2", createdAtMs: 15 },
      { id: "req-3", createdAtMs: 45 },
    ]) {
      runtime.createRequest({
        id: request.id,
        status: "pending",
        createdAtMs: request.createdAtMs,
        attempts: 0,
        currentNodeId: "client",
      });

      engine.schedule(
        createEvent(
          "request.created",
          request.createdAtMs,
          request.id,
          "client",
        ),
      );
    }

    engine.run();

    // req-1: created t=0 → api t=10 (healthy) → done t=25 before failure hits.
    expect(runtime.getRequest("req-1").status).toBe("completed");
    expect(runtime.getRequest("req-1").completedAtMs).toBe(25);

    // req-2: routed to api at t=25, inside the failure window → failed.
    expect(runtime.getRequest("req-2").status).toBe("failed");
    expect(runtime.getRequest("req-2").failedAtMs).toBe(25);

    // req-3: routed to api at t=55, after recovery at t=40 → completes.
    expect(runtime.getRequest("req-3").status).toBe("completed");
    expect(runtime.getRequest("req-3").completedAtMs).toBe(70);

    expect(runtime.eventQueue.isEmpty()).toBe(true);
  });
});

describe("request queueing", () => {
  const queueGraph: ArchitectureGraph = {
    nodes: [
      node("client", "client"),
      node("api", "api", { latencyMs: 10, replicas: 1, concurrency: 1 }),
    ],
    edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
  };

  it("should queue a request instead of failing at capacity", () => {
    const runtime = new SimulationRuntime(createSimulation(queueGraph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    const eventTypes: string[] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      eventTypes.push(event.type);
      originalProcess(event);
    };

    runtime.createRequest({
      id: "A",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    runtime.createRequest({
      id: "B",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    engine.schedule(createEvent("request.processing_started", 0, "A", "api"));

    engine.schedule(createEvent("request.processing_started", 0, "B", "api"));

    engine.run();

    // B was queued, not rejected.
    expect(eventTypes).not.toContain("request.failed");

    // Both requests completed successfully.
    expect(runtime.getRequest("A").status).toBe("completed");
    expect(runtime.getRequest("B").status).toBe("completed");

    expect(runtime.getComponent("api").activeRequests).toBe(0);
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });

  it("should release the slot and dequeue the next request on completion", () => {
    const { runtime, processor } = createRuntime(queueGraph);

    runtime.createRequest({
      id: "A",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    runtime.createRequest({
      id: "B",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    // A occupies the single slot.
    processor.process(createEvent("request.processing_started", 0, "A", "api"));

    expect(runtime.getComponent("api").activeRequests).toBe(1);

    // B is queued.
    processor.process(createEvent("request.processing_started", 0, "B", "api"));

    expect(runtime.getQueuedRequestCount("api")).toBe(1);

    // Drain A's scheduled processing_completed (from the successful start).
    const aCompleted = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(aCompleted?.type).toBe("request.processing_completed");

    // Manually process A's completion → slot released and a drain scheduled.
    processor.process(aCompleted!);

    expect(runtime.getComponent("api").activeRequests).toBe(0);

    // Processing the drain dequeues B.
    const drain = dequeueEventOfType(runtime, "queue.drain");
    processor.process(drain!);

    expect(runtime.getQueuedRequestCount("api")).toBe(0);

    // A processing_started for B was scheduled.
    const scheduled = dequeueEventOfType(runtime, "request.processing_started");

    expect(scheduled?.type).toBe("request.processing_started");
    expect(scheduled?.payload?.requestId).toBe("B");

    // Process B's event → B starts.
    processor.process(scheduled!);

    expect(runtime.getComponent("api").activeRequests).toBe(1);
    expect(runtime.getRequest("B").attempts).toBe(1);
  });

  it("should process three requests in FIFO order", () => {
    const runtime = new SimulationRuntime(createSimulation(queueGraph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    const completed: string[] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      originalProcess(event);
      if (
        event.type === "request.completed" &&
        typeof event.payload?.requestId === "string"
      ) {
        completed.push(event.payload.requestId);
      }
    };

    for (const id of ["A", "B", "C"]) {
      runtime.createRequest({
        id,
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });
    }

    // A starts at 0ms → occupies the slot.
    engine.schedule(createEvent("request.processing_started", 0, "A", "api"));
    // B and C try to start at 0ms → both get queued.
    engine.schedule(createEvent("request.processing_started", 0, "B", "api"));
    engine.schedule(createEvent("request.processing_started", 0, "C", "api"));

    engine.run();

    // Completion order: A → B → C (FIFO).
    expect(completed).toEqual(["A", "B", "C"]);

    // All three completed, nothing queued.
    expect(runtime.getComponent("api").activeRequests).toBe(0);
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });

  it("should queue only after filling all replica slots", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 10, replicas: 2, concurrency: 2 }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // effectiveConcurrency = 2 replicas * 2 concurrency = 4.
    for (const id of ["A", "B", "C", "D", "E"]) {
      runtime.createRequest({
        id,
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });
    }

    // First four requests fill all slots.
    for (const id of ["A", "B", "C", "D"]) {
      engine.schedule(createEvent("request.processing_started", 0, id, "api"));
    }

    // Fifth request has no capacity → queued.
    engine.schedule(createEvent("request.processing_started", 0, "E", "api"));

    engine.run();

    // All five completed.
    for (const id of ["A", "B", "C", "D", "E"]) {
      expect(runtime.getRequest(id).status).toBe("completed");
    }

    expect(runtime.getComponent("api").activeRequests).toBe(0);
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });

  it("should not consume capacity or queue slots on a failed retry", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", {
          concurrency: 1,
          errorRate: 1,
          retryPolicy: { retries: 1, circuitBreaker: false },
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    // All random rolls produce failures (0.4 < errorRate 1.0).
    vi.spyOn(runtime.random, "next").mockReturnValue(0.4);

    const eventTypes: string[] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      eventTypes.push(event.type);
      originalProcess(event);
    };

    runtime.createRequest({
      id: "A",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    runtime.createRequest({
      id: "B",
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "api",
    });

    // A starts processing → errorRate=1 means it fails without occupying the slot.
    engine.schedule(createEvent("request.processing_started", 0, "A", "api"));

    // B also starts → same outcome (A never held the slot, so B has capacity).
    engine.schedule(createEvent("request.processing_started", 0, "B", "api"));

    engine.run();

    // Both requests failed via error rate after exhausting retries.
    expect(runtime.getRequest("A").status).toBe("failed");
    expect(runtime.getRequest("B").status).toBe("failed");

    // Retries were scheduled and consumed.
    expect(eventTypes.filter((t) => t === "request.retry")).toHaveLength(2);
    expect(eventTypes.filter((t) => t === "request.failed")).toHaveLength(2);

    // activeRequests was never incremented (error path skips it).
    expect(runtime.getComponent("api").activeRequests).toBe(0);

    // Nothing was ever queued (error path never enqueues).
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });

  it("should maintain activeRequests <= effectiveConcurrency at all times", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api", { latencyMs: 5, replicas: 2, concurrency: 2 }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const runtime = new SimulationRuntime(createSimulation(graph));
    const processor = new DefaultEventProcessor(
      runtime,
      new AutoscalingController(runtime),
      new AutoscalingScheduler(runtime),
    );
    const engine = new SimulationEngine(
      runtime,
      processor,
      new TrafficGenerator(runtime),
      new FailureScheduler(runtime),
      new AutoscalingScheduler(runtime),
    );

    const effectiveConcurrency = runtime.getEffectiveConcurrency("api");

    let maxObserved = 0;

    const originalIncrement = runtime.incrementActiveRequests.bind(runtime);
    runtime.incrementActiveRequests = (nodeId: string) => {
      originalIncrement(nodeId);
      const current = runtime.getComponent(nodeId).activeRequests;
      if (current > maxObserved) maxObserved = current;
      expect(current).toBeLessThanOrEqual(effectiveConcurrency);
    };

    for (const id of ["A", "B", "C", "D", "E", "F"]) {
      runtime.createRequest({
        id,
        status: "in-flight",
        createdAtMs: 0,
        attempts: 0,
        currentNodeId: "api",
      });
    }

    // Six requests into a component with effectiveConcurrency=4.
    for (const id of ["A", "B", "C", "D", "E", "F"]) {
      engine.schedule(createEvent("request.processing_started", 0, id, "api"));
    }

    engine.run();

    // The invariant held throughout the run.
    expect(maxObserved).toBeLessThanOrEqual(effectiveConcurrency);
    expect(maxObserved).toBe(effectiveConcurrency);

    // All requests completed, nothing leaked.
    expect(runtime.getComponent("api").activeRequests).toBe(0);
    expect(runtime.getQueuedRequestCount("api")).toBe(0);
  });
});

describe("cache flow", () => {
  function cacheGraph(
    config: ArchitectureNode["config"] = {},
  ): ArchitectureGraph {
    return {
      nodes: [
        node("client", "client"),
        node("cache", "cache", {
          cache: { ttlMs: 1000, capacity: 4 },
          replicas: 1,
          concurrency: 1,
          latencyMs: 0,
          // Stay healthy throughout so cache tests observe the cache paths
          // without health-transition events interleaving with the requests.
          healthThresholds: {
            utilization: { degraded: 2, critical: 3 },
            errorRate: { degraded: 2, critical: 3 },
            latencyMs: { degraded: 1_000_000, critical: 2_000_000 },
          },
          ...config,
        }),
      ],
      edges: [{ id: "edge-1", source: "client", target: "cache", config: {} }],
    };
  }

  function createCacheRequest(
    runtime: SimulationRuntime,
    requestId: string,
    cacheKey: string,
  ): void {
    runtime.createRequest({
      id: requestId,
      status: "in-flight",
      createdAtMs: 0,
      attempts: 0,
      currentNodeId: "client",
      cacheKey,
    });
  }

  function routeToCache(
    processor: DefaultEventProcessor,
    requestId: string,
    timestampMs = 10,
  ): void {
    processor.process(
      createEvent("request.routed", timestampMs, requestId, "client", "cache"),
    );
  }

  function seedCacheEntry(
    runtime: SimulationRuntime,
    cacheKey = "GET:/users/123",
  ): void {
    runtime.setCacheEntry("cache", cacheKey, { requestId: "seed" });
  }

  it("should miss when no entry matches the request's stable cache key", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1");

    const miss = dequeueEventOfType(runtime, "cache.miss");

    expect(miss).toBeDefined();
    expect(miss?.sourceNodeId).toBe("cache");
    expect(miss?.targetNodeId).toBe("cache");
    expect(miss?.timestampMs).toBe(10);
    expect(miss?.payload?.requestId).toBe("req-1");
    expect(miss?.payload?.cacheKey).toBe("GET:/users/123");

    // The lookup itself counted the miss.
    expect(runtime.getCache("cache").misses).toBe(1);
    expect(runtime.getCache("cache").hits).toBe(0);

    processor.process(miss!);

    expect(runtime.getRequest("req-1").cacheMiss).toBe(true);
  });

  it("should store the fetched value under the stable key after a successful miss", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1");

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);
    const completed = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    )!;
    processor.process(completed);

    const set = dequeueEventOfType(runtime, "cache.set");
    expect(set).toBeDefined();
    expect(set?.payload?.cacheKey).toBe("GET:/users/123");
    expect(set?.payload?.value).toEqual({ requestId: "req-1" });
    processor.process(set!);

    const done = dequeueEventOfType(runtime, "request.completed")!;
    processor.process(done);

    const entry = runtime.getCacheEntry("cache", "GET:/users/123");

    expect(entry?.key).toBe("GET:/users/123");
    expect(entry?.value).toEqual({ requestId: "req-1" });
    expect(runtime.getCache("cache").size).toBe(1);
    expect(runtime.getRequest("req-1").status).toBe("completed");
  });

  it("should hit on a subsequent request that shares the stored cache key", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    seedCacheEntry(runtime, "GET:/users/123");
    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const hit = dequeueEventOfType(runtime, "cache.hit");

    expect(hit).toBeDefined();
    expect(hit?.payload?.cacheKey).toBe("GET:/users/123");
    processor.process(hit!);

    const done = dequeueEventOfType(runtime, "request.completed")!;
    processor.process(done);

    expect(runtime.getRequest("req-1").status).toBe("completed");
    expect(runtime.getRequest("req-1").cacheMiss).toBeUndefined();
    expect(runtime.getCache("cache").hits).toBe(1);
    expect(runtime.getCache("cache").misses).toBe(0);
  });

  it("should keep entries for different cache keys isolated", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    for (const [index, key] of [
      "GET:/users/123",
      "GET:/orders/456",
    ].entries()) {
      const requestId = `req-${index}`;

      createCacheRequest(runtime, requestId, key);
      routeToCache(processor, requestId, 10 + index * 10);

      const miss = dequeueEventOfType(runtime, "cache.miss");
      expect(miss).toBeDefined();
      expect(miss?.payload?.cacheKey).toBe(key);
      processor.process(miss!);

      const started = dequeueEventOfType(
        runtime,
        "request.processing_started",
      )!;
      processor.process(started);
      const completed = dequeueEventOfType(
        runtime,
        "request.processing_completed",
      )!;
      processor.process(completed);
      const set = dequeueEventOfType(runtime, "cache.set")!;
      processor.process(set);
      const done = dequeueEventOfType(runtime, "request.completed")!;
      processor.process(done);
    }

    expect(runtime.getCache("cache").size).toBe(2);
    expect(runtime.getCacheEntry("cache", "GET:/users/123")?.value).toEqual({
      requestId: "req-0",
    });
    expect(runtime.getCacheEntry("cache", "GET:/orders/456")?.value).toEqual({
      requestId: "req-1",
    });
    expect(runtime.getCache("cache").misses).toBe(2);
  });

  it("should complete a hit without entering normal processing", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    seedCacheEntry(runtime, "GET:/users/123");
    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const hit = dequeueEventOfType(runtime, "cache.hit")!;
    processor.process(hit);

    // A hit only schedules the completion, never a processing pass.
    const scheduled: SimulationEvent[] = [];

    while (!runtime.eventQueue.isEmpty()) {
      scheduled.push(runtime.eventQueue.dequeue()!);
    }

    expect(scheduled.map((event) => event.type)).toEqual(["request.completed"]);

    for (const event of scheduled) processor.process(event);

    expect(runtime.getRequest("req-1").status).toBe("completed");
  });

  it("should not consume processing capacity on a hit", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    seedCacheEntry(runtime, "GET:/users/123");
    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const hit = dequeueEventOfType(runtime, "cache.hit")!;
    processor.process(hit);

    const done = dequeueEventOfType(runtime, "request.completed")!;
    processor.process(done);

    expect(runtime.getComponent("cache").activeRequests).toBe(0);
    expect(runtime.getActiveRequestCount("cache")).toBe(0);
  });

  it("should not touch processing-attempt or latency counters on a hit", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    seedCacheEntry(runtime, "GET:/users/123");
    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const hit = dequeueEventOfType(runtime, "cache.hit")!;
    processor.process(hit);
    const done = dequeueEventOfType(runtime, "request.completed")!;
    processor.process(done);

    const component = runtime.getComponent("cache");

    expect(component.processedRequests).toBe(0);
    expect(component.totalProcessingAttempts).toBe(0);
    expect(component.failedProcessingAttempts).toBe(0);
    expect(component.totalProcessingLatencyMs).toBe(0);
    expect(component.lastProcessingLatencyMs).toBeUndefined();
  });

  it("should consume processing capacity while a miss is being processed", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);

    expect(runtime.getActiveRequestCount("cache")).toBe(1);
  });

  it("should count a miss as a normal processing attempt", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);

    expect(runtime.getComponent("cache").totalProcessingAttempts).toBe(1);
  });

  it("should record processing latency and free capacity when a miss completes", () => {
    const graph = cacheGraph({
      latencyMs: 20,
      cache: { ttlMs: 1000, capacity: 4, hitLatencyMs: 0, missLatencyMs: 0 },
    });
    const { runtime, processor } = createRuntime(graph);

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);

    expect(runtime.getActiveRequestCount("cache")).toBe(1);

    const completed = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );

    expect(completed?.timestampMs).toBe(30);
    processor.process(completed!);

    const component = runtime.getComponent("cache");

    expect(component.totalProcessingLatencyMs).toBe(20);
    expect(component.lastProcessingLatencyMs).toBe(20);
    expect(component.processedRequests).toBe(1);
    expect(component.activeRequests).toBe(0);
  });

  it("should evaluate component health when a miss completes", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const spy = vi.spyOn(runtime, "evaluateComponentHealth");

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);
    const completed = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    )!;
    processor.process(completed);

    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it("should store the cache entry before completing a miss", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);
    const completed = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    )!;
    processor.process(completed);

    const types: string[] = [];

    while (!runtime.eventQueue.isEmpty()) {
      const event = runtime.eventQueue.dequeue()!;
      types.push(event.type);

      if (event.type === "cache.set") {
        processor.process(event);
      }
    }

    expect(types).toContain("cache.set");
    expect(types).toContain("request.completed");
    expect(types.indexOf("cache.set")).toBeLessThan(
      types.indexOf("request.completed"),
    );

    // The entry is populated while the request still awaits completion.
    expect(runtime.getCacheEntry("cache", "GET:/users/123")?.value).toEqual({
      requestId: "req-1",
    });
    expect(runtime.getRequest("req-1").status).toBe("in-flight");
  });

  it("should drain the next queued request when a miss completes at saturation", () => {
    // Processing latency pushes A's completion past B's admission so the
    // events can be observed in a stable order.
    const graph = cacheGraph({
      latencyMs: 30,
      cache: { ttlMs: 1000, capacity: 4, hitLatencyMs: 0, missLatencyMs: 0 },
    });
    const { runtime, processor } = createRuntime(graph);

    createCacheRequest(runtime, "A", "GET:/a");
    createCacheRequest(runtime, "B", "GET:/b");

    // A enters processing and holds the only slot.
    routeToCache(processor, "A", 10);
    const missA = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(missA);
    const startA = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(startA);

    // B misses and is queued while A is still in-flight.
    routeToCache(processor, "B", 10);
    const missB = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(missB);
    const startB = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(startB);

    expect(runtime.getQueuedRequestCount("cache")).toBe(1);
    expect(runtime.getRequest("B").status).toBe("queued");
    expect(runtime.getRequest("B").cacheMiss).toBe(true);

    // Completing A frees the slot; the freed capacity drains B.
    const completeA = dequeueEventOfType(
      runtime,
      "request.processing_completed",
    );
    expect(completeA?.payload?.requestId).toBe("A");
    processor.process(completeA!);

    const transcript: { type: string; requestId?: string }[] = [];

    while (!runtime.eventQueue.isEmpty()) {
      const event = runtime.eventQueue.dequeue();

      if (!event) {
        break;
      }

      transcript.push({
        type: event.type,
        requestId: (event.payload as { requestId?: string } | undefined)
          ?.requestId,
      });

      processor.process(event);
    }

    // The drain ran and admitted the queued request B as a normal start.
    expect(transcript).toContainEqual({ type: "queue.drain" });
    expect(transcript).toContainEqual({
      type: "request.processing_started",
      requestId: "B",
    });
    expect(transcript.map((event) => event.type)).toContain("queue.dequeue");

    // Everything resolved: both entries stored, both requests completed, and
    // the queue is empty.
    expect(runtime.getCache("cache").size).toBe(2);
    expect(runtime.getCacheEntry("cache", "GET:/a")?.value).toEqual({
      requestId: "A",
    });
    expect(runtime.getCacheEntry("cache", "GET:/b")?.value).toEqual({
      requestId: "B",
    });
    expect(runtime.getRequest("A").status).toBe("completed");
    expect(runtime.getRequest("B").status).toBe("completed");
    expect(runtime.getQueuedRequestCount("cache")).toBe(0);
  });

  it("should keep cacheMiss true when a queued miss is admitted later", () => {
    const graph = cacheGraph({
      latencyMs: 30,
      cache: { ttlMs: 1000, capacity: 4, hitLatencyMs: 0, missLatencyMs: 0 },
    });
    const { runtime, processor } = createRuntime(graph);

    createCacheRequest(runtime, "A", "GET:/a");
    createCacheRequest(runtime, "B", "GET:/b");

    routeToCache(processor, "A", 10);
    processor.process(dequeueEventOfType(runtime, "cache.miss")!);
    processor.process(
      dequeueEventOfType(runtime, "request.processing_started")!,
    );

    routeToCache(processor, "B", 10);
    processor.process(dequeueEventOfType(runtime, "cache.miss")!);
    processor.process(
      dequeueEventOfType(runtime, "request.processing_started")!,
    );

    // B is queued with the miss context intact.
    expect(runtime.getRequest("B").cacheMiss).toBe(true);
    expect(runtime.getQueuedRequestCount("cache")).toBe(1);
    expect(runtime.getRequest("B").status).toBe("queued");

    // Completing A drains the queue and admits B.
    processor.process(
      dequeueEventOfType(runtime, "request.processing_completed")!,
    );

    while (!runtime.eventQueue.isEmpty()) {
      const event = runtime.eventQueue.dequeue();

      if (!event) {
        break;
      }

      processor.process(event);
    }

    // The miss context survived queue admission; completing the drained miss
    // stored its entry.
    expect(runtime.getRequest("B").cacheMiss).toBe(true);
    expect(runtime.getRequest("B").status).toBe("completed");
    expect(runtime.getCacheEntry("cache", "GET:/b")?.value).toEqual({
      requestId: "B",
    });
  });

  it("should not store an entry when a miss processing attempt fails", () => {
    const graph = cacheGraph({ errorRate: 1 });
    const { runtime, processor } = createRuntime(graph);

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);
    const started = dequeueEventOfType(runtime, "request.processing_started")!;
    processor.process(started);

    const failed = dequeueEventOfType(runtime, "request.failed");

    expect(failed).toBeDefined();
    expect(failed?.payload?.reason).toBe("component_error");
    processor.process(failed!);

    expect(runtime.getRequest("req-1").status).toBe("failed");
    expect(dequeueEventOfType(runtime, "cache.set")).toBeUndefined();
    expect(runtime.getCache("cache").size).toBe(0);
  });

  it("should respect the component error rate and retry policy on a miss", () => {
    const graph = cacheGraph({
      errorRate: 1,
      retryPolicy: { retries: 2, circuitBreaker: false },
    });
    const { runtime, processor } = createRuntime(graph);

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const miss = dequeueEventOfType(runtime, "cache.miss")!;
    processor.process(miss);

    const retryEvents: number[] = [];
    let terminal: SimulationEvent | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const started = dequeueEventOfType(runtime, "request.processing_started");

      expect(started).toBeDefined();
      processor.process(started!);

      // The miss context survives every retried attempt.
      expect(runtime.getRequest("req-1").cacheMiss).toBe(true);
      expect(runtime.getRequest("req-1").attempts).toBe(attempt);

      const outcome = runtime.eventQueue.dequeue();

      if (attempt < 3) {
        expect(outcome?.type).toBe("request.retry");
        retryEvents.push(outcome!.timestampMs);
        processor.process(outcome!);
      } else {
        terminal = outcome;
      }
    }

    expect(retryEvents).toHaveLength(2);
    expect(terminal?.type).toBe("request.failed");
    processor.process(terminal!);

    const component = runtime.getComponent("cache");

    expect(runtime.getRequest("req-1").status).toBe("failed");
    expect(runtime.getRequest("req-1").attempts).toBe(3);
    expect(component.totalProcessingAttempts).toBe(3);
    expect(component.failedProcessingAttempts).toBe(3);
    expect(dequeueEventOfType(runtime, "cache.set")).toBeUndefined();
    expect(runtime.getCache("cache").size).toBe(0);
  });

  it("should reject a cache hit on a failed component", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    seedCacheEntry(runtime, "GET:/users/123");
    runtime.setComponentHealth("cache", "failed");

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const next = runtime.eventQueue.dequeue();

    expect(next?.type).toBe("request.failed");
    expect(next?.payload?.reason).toBe("component_failed");
    processor.process(next!);

    // No cache lookup (and therefore no hit) alongside the failure.
    expect(dequeueEventOfType(runtime, "cache.hit")).toBeUndefined();
    expect(runtime.getRequest("req-1").status).toBe("failed");

    // The lookup never ran, so no cache counters moved.
    expect(runtime.getCache("cache").hits).toBe(0);
    expect(runtime.getCache("cache").misses).toBe(0);
  });

  it("should reject a cache miss on a failed component", () => {
    const { runtime, processor } = createRuntime(cacheGraph());

    runtime.setComponentHealth("cache", "failed");

    createCacheRequest(runtime, "req-1", "GET:/users/123");
    routeToCache(processor, "req-1", 10);

    const next = runtime.eventQueue.dequeue();

    expect(next?.type).toBe("request.failed");
    expect(next?.payload?.reason).toBe("component_failed");
    processor.process(next!);

    // No cache lookup (and therefore no miss) alongside the failure.
    expect(dequeueEventOfType(runtime, "cache.miss")).toBeUndefined();
    expect(runtime.getRequest("req-1").status).toBe("failed");
    expect(runtime.getCache("cache").misses).toBe(0);
  });

  it("should clear cache entries and restore counters on runtime reset", () => {
    const graph = cacheGraph({ cache: { ttlMs: 1000, capacity: 2 } });
    const { runtime } = createRuntime(graph);

    runtime.setCacheEntry("cache", "K1", "v1");
    runtime.setCacheEntry("cache", "K2", "v2");
    // Exceeds capacity: evicts the least-recently-used entry (K1).
    runtime.setCacheEntry("cache", "K3", "v3");

    expect(runtime.getCache("cache").size).toBe(2);
    expect(runtime.getCache("cache").evictions).toBe(1);

    // Move the hit/miss counters.
    runtime.getCacheEntry("cache", "K2");
    runtime.getCacheEntry("cache", "missing");

    expect(runtime.getCache("cache").hits).toBe(1);
    expect(runtime.getCache("cache").misses).toBe(1);

    runtime.reset();

    const cache = runtime.getCache("cache");

    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
    expect(cache.evictions).toBe(0);
    expect(runtime.getCacheEntry("cache", "K2")).toBeUndefined();
  });

  it("should produce deterministic hit/miss outcomes and cache stats for the same seed and event sequence", () => {
    const graph = cacheGraph();

    const run = (seed: number) => {
      const { runtime, processor } = createRuntime(graph, seed);
      const outcomes: string[] = [];
      const keys = ["GET:/a", "GET:/b", "GET:/a", "GET:/b"];

      keys.forEach((cacheKey, index) => {
        const requestId = `req-${index}`;

        createCacheRequest(runtime, requestId, cacheKey);
        routeToCache(processor, requestId, 10);

        const next = runtime.eventQueue.dequeue()!;

        if (next.type === "cache.hit") {
          processor.process(next);
          processor.process(dequeueEventOfType(runtime, "request.completed")!);
          outcomes.push("hit");
          return;
        }

        expect(next.type).toBe("cache.miss");
        processor.process(next);
        processor.process(
          dequeueEventOfType(runtime, "request.processing_started")!,
        );
        processor.process(
          dequeueEventOfType(runtime, "request.processing_completed")!,
        );
        processor.process(dequeueEventOfType(runtime, "cache.set")!);
        processor.process(dequeueEventOfType(runtime, "request.completed")!);
        outcomes.push("miss");
      });

      const cache = runtime.getCache("cache");

      return {
        outcomes,
        stats: {
          hits: cache.hits,
          misses: cache.misses,
          evictions: cache.evictions,
        },
      };
    };

    const runA = run(42);
    const runB = run(42);

    expect(runA).toEqual(runB);
    expect(runA.outcomes).toEqual(["miss", "miss", "hit", "hit"]);
    expect(runA.stats).toEqual({ hits: 2, misses: 2, evictions: 0 });
  });
});
