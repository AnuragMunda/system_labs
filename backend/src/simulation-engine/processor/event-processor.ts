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

    this.routeRequest(requestId, event.simulationId, event.timestampMs);
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

    const request = this.runtime.getRequest(requestId);

    this.runtime.updateRequest(requestId, {
      status: "in-flight",
      currentNodeId: event.targetNodeId,
    });

    this.routeRequest(request.id, event.simulationId, event.timestampMs);
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
    const requestId = this.getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error(
        "request.processing_completed event requires a sourceNodeId.",
      );
    }

    this.runtime.decrementActiveRequests(event.sourceNodeId);

    this.runtime.recordProcessedRequest(event.sourceNodeId);

    const nextNodes = this.runtime.topology.getNextNodes(event.sourceNodeId);

    // Terminal component — no connections to travel across, so complete.
    if (nextNodes.length === 0) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.completed",
        sourceNodeId: event.sourceNodeId,
        payload: {
          requestId,
        },
      });

      return;
    }

    // Multiple outgoing connections require a routing policy that doesn't
    // exist yet.
    if (nextNodes.length > 1) {
      throw new Error(
        `Multiple outgoing connections from node ${event.sourceNodeId} require a routing policy.`,
      );
    }

    const nextNode = nextNodes[0];

    if (!nextNode) {
      throw new Error(
        `Unable to determine next node for request ${requestId}.`,
      );
    }

    // The request must travel across the connection, so its latency is added.
    const networkLatencyMs = this.getConnectionLatencyMs(
      event.sourceNodeId,
      nextNode.id,
    );

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + networkLatencyMs,
      type: "request.routed",
      sourceNodeId: event.sourceNodeId,
      targetNodeId: nextNode.id,
      payload: {
        requestId,
      },
    });
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
   * Determines where a request should go next based on
   * the architecture graph.
   *
   * Routing rules for the current MVP:
   *
   * 0 outgoing nodes → request.completed
   * 1 outgoing node   → request.routed
   * >1 outgoing nodes → throw
   */

  private routeRequest(
    requestId: string,
    simulationId: string,
    timestampMs: number,
  ): void {
    const request = this.runtime.getRequest(requestId);

    if (!request.currentNodeId) {
      throw new Error(`Request ${requestId} has no currentNodeId.`);
    }

    const nextNodes = this.runtime.topology.getNextNodes(request.currentNodeId);

    if (nextNodes.length === 0) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId,
        timestampMs,
        type: "request.completed",
        sourceNodeId: request.currentNodeId,
        payload: {
          requestId,
        },
      });

      return;
    }

    if (nextNodes.length > 1) {
      throw new Error(
        `Multiple outgoing connections from node ${request.currentNodeId} require a routing policy.`,
      );
    }

    const nextNode = nextNodes[0];

    if (!nextNode) {
      throw new Error(
        `Unable to determine next node for request ${requestId}.`,
      );
    }

    // The request travels across the connecting edge, so its latency applies.
    const networkLatency = this.getConnectionLatencyMs(
      request.currentNodeId,
      nextNode.id,
    );

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId,
      timestampMs: timestampMs + networkLatency,
      type: "request.routed",
      sourceNodeId: request.currentNodeId,
      targetNodeId: nextNode.id,
      payload: {
        requestId,
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

  /**
   * Resolves the network latency for a hop between two components. Looks up
   * the connecting edge in the topology and, when it is missing, throws so a
   * malformed graph fails loudly rather than silently mis-routing.
   */
  private getConnectionLatencyMs(
    sourceNodeId: string,
    targetNodeId: string,
  ): number {
    const edge = this.runtime.topology.getEdge(sourceNodeId, targetNodeId);

    if (!edge) {
      throw new Error(
        `No connection found from ${sourceNodeId} to ${targetNodeId}.`,
      );
    }

    const networkLatencyMs = getNetworkLatency(edge);

    return networkLatencyMs;
  }
}
