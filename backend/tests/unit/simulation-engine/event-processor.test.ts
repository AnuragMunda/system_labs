import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { ArchitectureNode } from "@/domain/architecture/component.types.js";
import { describe, expect, it } from "vitest";

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
      { id: "edge-1", source: "client", target: "api", config: {} },
      { id: "edge-2", source: "api", target: "database", config: {} },
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

  it("should throw when a node has multiple outgoing connections", () => {
    const graph: ArchitectureGraph = {
      nodes: [
        {
          id: "client",
          type: "client",
          name: "Client",
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: "api-1",
          type: "api",
          name: "API 1",
          position: { x: 100, y: 0 },
          config: {},
        },
        {
          id: "api-2",
          type: "api",
          name: "API 2",
          position: { x: 100, y: 100 },
          config: {},
        },
      ],
      edges: [
        { id: "edge-1", source: "client", target: "api-1", config: {} },
        { id: "edge-2", source: "client", target: "api-2", config: {} },
      ],
    };

    const { processor } = createRuntime(graph);

    const event = createEvent("request.created", 0, "req-1", "client");

    expect(() => processor.process(event)).toThrowError(
      "Multiple outgoing connections from node client require a routing policy.",
    );
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
