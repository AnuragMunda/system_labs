import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
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
): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "running",
    config: {
      durationMs: 1000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    currentTimeMs: 0,
    seed: 42,
    architectureSnapshot: graph,
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

function createRuntime(graph: ArchitectureGraph = createGraph()) {
  const runtime = new SimulationRuntime(createSimulation(graph));
  const processor = new DefaultEventProcessor(runtime);

  return { runtime, processor };
}

describe("DefaultEventProcessor", () => {
  it("should create a pending request and schedule its first route on request.created", () => {
    const { runtime, processor } = createRuntime();

    const event = createEvent("request.created", 0, "req-1", "client");

    processor.process(event);

    expect(runtime.currentTimeMs).toBe(0);

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.routed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.sourceNodeId).toBe("client");
    expect(scheduled?.targetNodeId).toBe("api");
    expect(scheduled?.payload?.requestId).toBe("req-1");

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("pending");
    expect(request.createdAtMs).toBe(0);
    expect(request.currentNodeId).toBe("client");
  });

  it("should move a request and schedule the next hop on request.routed", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      currentNodeId: "client",
    });

    processor.process(
      createEvent("request.routed", 10, "req-1", "client", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.routed");
    // The next hop is offset 10ms from the routed event's own timestamp.
    expect(scheduled?.timestampMs).toBe(20);
    expect(scheduled?.targetNodeId).toBe("database");

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("in-flight");
    expect(request.currentNodeId).toBe("api");
  });

  it("should schedule the next hop using the edge latency on request.routed", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api"),
        node("database", "database"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "client",
          target: "api",
          config: { latencyMs: 25 },
        },
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
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      currentNodeId: "client",
    });

    processor.process(
      createEvent("request.routed", 10, "req-1", "client", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.routed");
    // The request arrives at api at 10ms; edge api->database latency is 5ms.
    expect(scheduled?.timestampMs).toBe(15);
    expect(scheduled?.targetNodeId).toBe("database");
  });

  it("should apply the default network latency when the edge has no latency", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("client", "client"),
        node("api", "api"),
        node("database", "database"),
      ],
      edges: [
        {
          id: "edge-1",
          source: "client",
          target: "api",
          config: { latencyMs: 7 },
        },
        {
          id: "edge-2",
          source: "api",
          target: "database",
          config: {},
        },
      ],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 0,
      currentNodeId: "client",
    });

    processor.process(
      createEvent("request.routed", 10, "req-1", "client", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    // Edge api->database has no latency configured, so the 10ms default applies.
    expect(scheduled?.type).toBe("request.routed");
    expect(scheduled?.timestampMs).toBe(20);
    expect(scheduled?.targetNodeId).toBe("database");
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
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_completed", 30, "req-1", "api"),
    );

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
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.processing_completed");
    expect(scheduled?.timestampMs).toBe(60);
    expect(scheduled?.payload?.requestId).toBe("req-1");

    expect(runtime.getComponent("api").activeRequests).toBe(1);
  });

  it("should fail a request when the component capacity is exceeded", () => {
    const graph: ArchitectureGraph = {
      nodes: [node("client", "client"), node("api", "api", { capacity: 1 })],
      edges: [{ id: "edge-1", source: "client", target: "api", config: {} }],
    };

    const { runtime, processor } = createRuntime(graph);

    runtime.incrementActiveRequests("api");

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
      currentNodeId: "api",
    });

    processor.process(
      createEvent("request.processing_started", 10, "req-1", "api"),
    );

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.failed");
    expect(scheduled?.timestampMs).toBe(10);
    expect(scheduled?.payload?.reason).toBe("component_capacity_exceeded");

    // The request was rejected, so the component's active count is unchanged.
    expect(runtime.getComponent("api").activeRequests).toBe(1);
  });

  it("should fail a request when the component has failed", () => {
    const { runtime, processor } = createRuntime();

    runtime.updateComponent("api", { health: "failed" });

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 0,
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
      currentNodeId: "database",
    });

    processor.process(
      createEvent("request.processing_completed", 30, "req-1", "database"),
    );

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
        node("gateway", "load_balancer"),
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
      currentNodeId: "gateway",
    });
    runtime.createRequest({
      id: "req-2",
      status: "pending",
      createdAtMs: 0,
      currentNodeId: "gateway",
    });

    // Route two requests from the gateway; each should take the next edge in
    // round-robin order without a routing policy failure.
    processor.process(
      createEvent("request.routed", 10, "req-1", "gateway", "gateway"),
    );
    processor.process(
      createEvent("request.routed", 10, "req-2", "gateway", "gateway"),
    );

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
        node("gateway", "load_balancer"),
        node("queue", "queue"),
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
      currentNodeId: "gateway",
    });
    runtime.createRequest({
      id: "req-2",
      status: "pending",
      createdAtMs: 0,
      currentNodeId: "queue",
    });

    // Gateway routes its first request, then queue routes its first. Their
    // counters must advance independently and not interfere.
    processor.process(
      createEvent("request.routed", 0, "req-1", "gateway", "gateway"),
    );
    processor.process(
      createEvent("request.routed", 0, "req-2", "queue", "queue"),
    );

    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("api-1");
    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("worker-1");

    // Second round: gateway still advances its own position to api-2 while
    // queue stays on its own worker-2.
    processor.process(
      createEvent("request.routed", 0, "req-1", "gateway", "gateway"),
    );
    processor.process(
      createEvent("request.routed", 0, "req-2", "queue", "queue"),
    );

    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("api-2");
    expect(runtime.eventQueue.dequeue()?.targetNodeId).toBe("worker-2");
  });

  it("should apply each edge's latency when round-robin routing", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        node("gateway", "load_balancer"),
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
      currentNodeId: "gateway",
    });
    processor.process(
      createEvent("request.routed", 0, "req-1", "gateway", "gateway"),
    );

    const first = runtime.eventQueue.dequeue();

    expect(first?.type).toBe("request.routed");
    expect(first?.targetNodeId).toBe("api-1");
    expect(first?.timestampMs).toBe(5);

    // Request 2 takes the next edge, whose latency is higher.
    runtime.createRequest({
      id: "req-2",
      status: "pending",
      createdAtMs: 0,
      currentNodeId: "gateway",
    });
    processor.process(
      createEvent("request.routed", 0, "req-2", "gateway", "gateway"),
    );

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
      currentNodeId: "api",
    });

    const selectEdgeSpy = vi.spyOn(runtime.routingStrategy, "selectEdge");

    // Route the request to the terminal database node.
    processor.process(
      createEvent("request.routed", 10, "req-1", "api", "database"),
    );

    // The terminal node has no outgoing edges, so the request completes and
    // the routing strategy must not be consulted.
    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.completed");
    expect(scheduled?.timestampMs).toBe(10);

    expect(selectEdgeSpy).not.toHaveBeenCalled();
  });
});

describe("SimulationEngine with DefaultEventProcessor", () => {
  it("should route a request through Client → API → Database and complete it", () => {
    const runtime = new SimulationRuntime(createSimulation());
    const processor = new DefaultEventProcessor(runtime);
    const engine = new SimulationEngine(runtime, processor);

    const processed: { type: SimulationEvent["type"]; target?: string }[] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      processed.push({ type: event.type, target: event.targetNodeId });
      originalProcess(event);
    };

    engine.schedule(createEvent("request.created", 0, "req-1", "client"));

    engine.run();

    expect(processed).toEqual([
      { type: "request.created", target: undefined },
      { type: "request.routed", target: "api" },
      { type: "request.routed", target: "database" },
      { type: "request.completed", target: undefined },
    ]);

    expect(runtime.eventQueue.isEmpty()).toBe(true);

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("completed");
    expect(request.currentNodeId).toBe("database");
    expect(request.createdAtMs).toBe(0);
    expect(request.completedAtMs).toBe(20);
    expect(runtime.currentTimeMs).toBe(20);
  });
});
