import { SimulationEngine } from "@/simulation-engine/core/simulation-engine.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import { DefaultEventProcessor } from "@/simulation-engine/processor/event-processor.js";
import { Simulation } from "@/domain/simulation/simulation.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { SimulationRequest } from "@/domain/simulation/request.types.js";
import { describe, expect, it } from "vitest";

const targetNodeId = "api-1";

function createSimulation(): Simulation {
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
    architectureSnapshot: { nodes: [], edges: [] },
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function createEvent(
  type: SimulationEvent["type"],
  timestampMs: number,
  requestId: string,
  id = "event-1",
): SimulationEvent {
  return {
    id,
    simulationId: "simulation-1",
    timestampMs,
    type,
    sourceNodeId: "source-1",
    targetNodeId,
    payload: { requestId },
  };
}

function createRuntime() {
  const runtime = new SimulationRuntime(createSimulation());
  const processor = new DefaultEventProcessor(runtime);

  return { runtime, processor };
}

describe("DefaultEventProcessor", () => {
  it("should schedule a request.routed event 10ms after request.created", () => {
    const { runtime, processor } = createRuntime();

    const event = createEvent("request.created", 100, "req-1");

    processor.process(event);

    expect(runtime.eventQueue.size()).toBe(1);
    expect(runtime.currentTimeMs).toBe(0);

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.routed");
    expect(scheduled?.timestampMs).toBe(110);
    expect(scheduled?.payload?.requestId).toBe("req-1");

    const createdRequest = runtime.getRequest("req-1");

    expect(createdRequest.status).toBe("pending");
    expect(createdRequest.createdAtMs).toBe(100);
    expect(createdRequest.currentNodeId).toBe("source-1");
  });

  it("should schedule a request.completed event 20ms after request.routed and mark the request in-flight", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "pending",
      createdAtMs: 100,
    });

    const event = createEvent("request.routed", 110, "req-1");

    processor.process(event);

    expect(runtime.eventQueue.size()).toBe(1);

    const scheduled = runtime.eventQueue.dequeue();

    expect(scheduled?.type).toBe("request.completed");
    expect(scheduled?.timestampMs).toBe(130);
    expect(scheduled?.payload?.requestId).toBe("req-1");

    const inFlightRequest = runtime.getRequest("req-1");

    expect(inFlightRequest.status).toBe("in-flight");
    expect(inFlightRequest.currentNodeId).toBe(targetNodeId);
  });

  it("should mark the request completed when a request.completed event is processed", () => {
    const { runtime, processor } = createRuntime();

    runtime.createRequest({
      id: "req-1",
      status: "in-flight",
      createdAtMs: 110,
    });

    const event = createEvent("request.completed", 130, "req-1");

    processor.process(event);

    const completedRequest = runtime.getRequest("req-1");

    expect(completedRequest.status).toBe("completed");
    expect(completedRequest.completedAtMs).toBe(130);
  });

  it("should throw when a request.created event lacks a requestId", () => {
    const { processor } = createRuntime();

    const event: SimulationEvent = {
      id: "event-1",
      simulationId: "simulation-1",
      timestampMs: 100,
      type: "request.created",
    };

    expect(() => processor.process(event)).toThrowError(
      "request.created event requires a requestId.",
    );
  });

  it("should throw when a request.routed event lacks a requestId", () => {
    const { processor } = createRuntime();

    const event: SimulationEvent = {
      id: "event-1",
      simulationId: "simulation-1",
      timestampMs: 100,
      type: "request.routed",
    };

    expect(() => processor.process(event)).toThrowError(
      "request.routed event requires a requestId.",
    );
  });
});

describe("SimulationEngine with DefaultEventProcessor", () => {
  it("should process the full request lifecycle chain in order", () => {
    const runtime = new SimulationRuntime(createSimulation());
    const processor = new DefaultEventProcessor(runtime);
    const engine = new SimulationEngine(runtime, processor);

    const processedTypes: SimulationEvent["type"][] = [];

    const originalProcess = processor.process.bind(processor);
    processor.process = (event) => {
      processedTypes.push(event.type);
      originalProcess(event);
    };

    engine.schedule(createEvent("request.created", 0, "req-1"));

    engine.run();

    expect(processedTypes).toEqual([
      "request.created",
      "request.routed",
      "request.completed",
    ]);
    expect(runtime.currentTimeMs).toBe(30);
    expect(runtime.eventQueue.isEmpty()).toBe(true);

    const request = runtime.getRequest("req-1");

    expect(request.status).toBe("completed");
    expect(request.createdAtMs).toBe(0);
    expect(request.completedAtMs).toBe(30);
    expect(request).toMatchObject<Partial<SimulationRequest>>({ id: "req-1" });
  });
});
