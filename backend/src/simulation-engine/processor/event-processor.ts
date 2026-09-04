/**
 * @file event-processor.ts
 *
 * @description The default event processor. Converts each simulation event
 * into request state transitions in the runtime and schedules follow-up events,
 * routing every request through the architecture's topology until it completes.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import { SimulationRuntime } from "../core/simulation-runtime.js";
import { EventProcessor } from "../types.js";
import { getNetworkLatency } from "../network/network-latency.js";

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

      case "request.processing_started":
        this.handleProcessingStarted(event);
        break;

      case "request.processing_completed":
        this.handleProcessingCompleted(event);
        break;

      case "request.completed":
        this.handleRequestCompleted(event);
        break;

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // request.created
  // ---------------------------------------------------------------------------

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

    this.routeRequest(event, event.sourceNodeId);
  }

  // ---------------------------------------------------------------------------
  // request.routed
  // ---------------------------------------------------------------------------

  /**
   * Moves the request to the target node and determines
   * where it should go next.
   */
  private handleRequestRouted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    if (!event.targetNodeId) {
      throw new Error("request.routed event requires a targetNodeId.");
    }

    this.runtime.updateRequest(requestId, {
      status: "in-flight",
      currentNodeId: event.targetNodeId,
    });

    this.routeRequest(event, event.targetNodeId);
  }

  // ---------------------------------------------------------------------------
  // request.processing_started
  // ---------------------------------------------------------------------------

  private handleProcessingStarted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error(
        "request.processing_started event requires a sourceNodeId.",
      );
    }

    const component = this.runtime.getComponent(event.sourceNodeId);

    // Component cannot process requests when failed.
    if (component.health === "failed") {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.failed",
        sourceNodeId: event.sourceNodeId,
        payload: {
          requestId,
          reason: "component_failed",
        },
      });

      return;
    }

    const node = this.runtime.topology.getNode(event.sourceNodeId);

    if (!node) {
      throw new Error(`Node not found: ${event.sourceNodeId}`);
    }

    const capacity = node.config.capacity;

    if (capacity !== undefined && component.activeRequests >= capacity) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.failed",
        sourceNodeId: event.sourceNodeId,
        payload: {
          requestId,
          reason: "component_capacity_exceeded",
        },
      });

      return;
    }

    this.runtime.incrementActiveRequests(event.sourceNodeId);

    const latencyMs = node.config.latencyMs ?? 0;

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + latencyMs,
      type: "request.processing_completed",
      sourceNodeId: event.sourceNodeId,
      payload: {
        requestId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // request.processing_completed
  // ---------------------------------------------------------------------------

  /**
   * Finalizes processing on the current component and moves the request
   * toward the next component. Routing is applied inline (rather than via
   * routeRequest) so the network latency of the outgoing connection is
   * accounted for, or the request is completed at a terminal component.
   */
  private handleProcessingCompleted(event: SimulationEvent): void {
    // Validates that the event carries a requestId.
    this.getRequestId(event);

    const sourceNodeId = event.sourceNodeId;

    if (!sourceNodeId) {
      throw new Error(
        "request.processing_completed event requires a sourceNodeId.",
      );
    }

    this.runtime.decrementActiveRequests(sourceNodeId);
    this.runtime.recordProcessedRequest(sourceNodeId);

    this.routeRequest(event, sourceNodeId);
  }

  // ---------------------------------------------------------------------------
  // request.completed
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Determines where a request should go next based on the outgoing
   * connections of its current component.
   *
   * Routing rules for the current MVP:
   *
   * 0 outgoing edges  → request.completed (no routing performed)
   * >= 1 outgoing edge → select one via the runtime's routing strategy, then
   *                      request.routed after that edge's network latency
   */

  private routeRequest(event: SimulationEvent, sourceNodeId: string): void {
    const edges = this.runtime.topology.getOutgoingEdges(sourceNodeId);

    if (edges.length === 0) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.completed",
        sourceNodeId,
        payload: {
          requestId: this.getRequestId(event),
        },
      });

      return;
    }

    const selectedEdge = this.runtime.routingStrategy.selectEdge(edges, {
      sourceNodeId,
      requestId: this.getRequestId(event),
    });

    const networkLatencyMs = getNetworkLatency(selectedEdge);

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + networkLatencyMs,
      type: "request.routed",
      sourceNodeId: selectedEdge.source,
      targetNodeId: selectedEdge.target,
      payload: {
        requestId: this.getRequestId(event),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private getRequestId(event: SimulationEvent): string {
    const requestId = event.payload?.requestId;

    if (typeof requestId !== "string") {
      throw new Error(`${event.type} event requires a requestId.`);
    }

    return requestId;
  }
}
