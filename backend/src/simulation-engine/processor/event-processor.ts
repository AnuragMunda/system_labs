import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import { SimulationRuntime } from "../core/simulation-runtime.js";
import type { EventProcessor } from "../types.js";

export class DefaultEventProcessor implements EventProcessor {
  constructor(private readonly runtime: SimulationRuntime) {}

  process(event: SimulationEvent): void {
    switch (event.type) {
      case "request.created":
        this.handleRequestCreated(event);
        break;

      case "request.routed":
        this.handleRequestRouted(event);
        break;

      case "request.completed":
        this.handleRequestCompleted(event);
        break;

      default:
        break;
    }
  }

  private handleRequestCreated(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    this.runtime.createRequest({
      id: requestId,
      status: "pending",
      createdAtMs: event.timestampMs,
      currentNodeId: event.sourceNodeId,
    });

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + 10,
      type: "request.routed",
      sourceNodeId: event.sourceNodeId,
      targetNodeId: event.targetNodeId,
      payload: {
        requestId,
      },
    });
  }

  private handleRequestRouted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    this.runtime.updateRequest(requestId, {
      status: "in-flight",
      currentNodeId: event.targetNodeId,
    });

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + 20,
      type: "request.completed",
      sourceNodeId: event.sourceNodeId,
      targetNodeId: event.targetNodeId,
      payload: {
        requestId,
      },
    });
  }

  private handleRequestCompleted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    this.runtime.updateRequest(requestId, {
      status: "completed",
      completedAtMs: event.timestampMs,
    });
  }

  private getRequestId(event: SimulationEvent): string {
    const requestId = event.payload?.requestId;

    if (typeof requestId !== "string") {
      throw new Error(`${event.type} event requires a requestId.`);
    }

    return requestId;
  }
}
