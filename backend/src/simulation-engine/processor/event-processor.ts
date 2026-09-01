/**
 * @file event-processor.ts
 *
 * @description The default event processor. Converts each simulation event
 * into request state transitions in the runtime and schedules follow-up events,
 * routing every request through the architecture's topology until it completes.
 */

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

  /**
   * Creates the request and determines its first destination
   * from the architecture topology.
   */
  private handleRequestCreated(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error("request.created event requires a sourceNodeId.");
    }

    this.runtime.createRequest({
      id: requestId,
      status: "pending",
      createdAtMs: event.timestampMs,
      currentNodeId: event.sourceNodeId,
    });

    this.routeRequest(requestId, event.simulationId);
  }

  /**
   * Moves the request to the target node and determines
   * where it should go next.
   */
  private handleRequestRouted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    if (!event.targetNodeId) {
      throw new Error("request.routed event requires a targetNodeId.");
    }

    const request = this.runtime.getRequest(requestId);

    this.runtime.updateRequest(requestId, {
      status: "in-flight",
      currentNodeId: event.targetNodeId,
    });

    this.routeRequest(request.id, event.simulationId);
  }

  /**
   * Completes the request.
   */
  private handleRequestCompleted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    this.runtime.getRequest(requestId);

    this.runtime.updateRequest(requestId, {
      status: "completed",
      completedAtMs: event.timestampMs,
    });
  }

  /**
   * Determines where a request should go next based on
   * the architecture graph.
   *
   * Routing rules for the current MVP:
   *
   * 0 outgoing nodes → request.completed
   * 1 outgoing node   → request.routed
   * >1 outgoing nodes → throw
   */
  private routeRequest(requestId: string, simulationId: string): void {
    const request = this.runtime.getRequest(requestId);

    if (!request.currentNodeId)
      throw new Error(`Request ${requestId} has no currentNodeId.`);

    const nextNodes = this.runtime.topology.getNextNodes(request.currentNodeId);

    // Terminal node
    if (nextNodes.length === 0) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId,
        timestampMs: this.runtime.currentTimeMs + 10,
        type: "request.completed",
        sourceNodeId: request.currentNodeId,
        targetNodeId: request.currentNodeId,
        payload: {
          requestId,
        },
      });

      return;
    }

    // We don't have a routing strategy yet.
    if (nextNodes.length > 1)
      throw new Error(
        `Multiple outgoing connections from node ${request.currentNodeId} require a routing policy.`,
      );

    const nextNode = nextNodes[0];

    if (!nextNode)
      throw new Error(
        `Unable to determine next node for request ${requestId}.`,
      );

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId,
      timestampMs: this.runtime.currentTimeMs + 10,
      type: "request.routed",
      sourceNodeId: request.currentNodeId,
      targetNodeId: nextNode.id,
      payload: {
        requestId,
      },
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
