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
import { canRetry, DEFAULT_RETRY_DELAY_MS, shouldFail } from "../helper.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import { ComponentRuntimeState } from "../components/component-runtime-state.js";
import { AutoscalingController } from "../autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "../autoscaling/autoscaling-scheduler.js";

export class DefaultEventProcessor implements EventProcessor {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly autoscalingController: AutoscalingController,
    private readonly autoscalingScheduler: AutoscalingScheduler,
  ) {}

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

      case "request.failed":
        this.handleRequestFailed(event);
        break;

      case "request.retry":
        this.handleRequestRetry(event);
        break;

      case "component.failed":
        this.handleComponentFailed(event);
        break;

      case "component.recovery":
        this.handleComponentRecovery(event);
        break;

      case "component.recovered":
        this.handleComponentRecovered(event);
        break;

      case "component.health_changed":
        this.handleComponentHealthChanged(event);
        break;

      // component.recovery_scheduled is observability-only and intentionally
      // has no handler; it shares the timestamp and payload data of the
      // component.recovery event it accompanies.

      case "autoscaling.evaluate":
        this.handleAutoscalingEvaluate(event);
        break;

      case "component.scaled":
        this.handleComponentScaled(event);
        break;

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // request.created
  // ---------------------------------------------------------------------------

  /**
   * Updates the newly created request and determines its first destination
   * from the architecture topology.
   */
  private handleRequestCreated(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error("request.created event requires a sourceNodeId.");
    }

    this.runtime.getRequest(requestId);

    this.runtime.updateRequest(requestId, {
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

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs,
      type: "request.processing_started",
      sourceNodeId: event.targetNodeId,
      targetNodeId: event.targetNodeId,
      payload: {
        requestId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // request.processing_started
  // ---------------------------------------------------------------------------

  private handleProcessingStarted(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);
    const request = this.runtime.getRequest(requestId);

    // 1. Validate component
    if (!event.sourceNodeId) {
      throw new Error(
        "request.processing_started event requires a sourceNodeId.",
      );
    }

    const node = this.runtime.topology.getNode(event.sourceNodeId);

    if (!node) {
      throw new Error(`Node not found: ${event.sourceNodeId}`);
    }

    // 2. Check component health
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

    if (!this.runtime.hasCapacity(event.sourceNodeId)) {
      this.runtime.enqueueRequest(event.sourceNodeId, requestId);
      return;
    }

    // 4. Increment attempt
    const currentAttempt = request.attempts + 1;

    this.runtime.updateRequest(requestId, {
      attempts: currentAttempt,
    });

    // Feed the health evaluator with the attempt; failures are counted too.
    this.runtime.recordProcessingAttempt(event.sourceNodeId);

    // 5. Evaluate error rate
    const errorRate = node.config.errorRate ?? 0;

    const failed = shouldFail(errorRate, this.runtime.random.next());

    // 6. If error → retry/fail
    if (failed) {
      this.runtime.recordProcessingFailure(event.sourceNodeId);

      const retryPolicy = node.config.retryPolicy;
      const maxRetries = retryPolicy?.retries;

      const retryAllowed = canRetry(currentAttempt, maxRetries ?? 0);

      if (retryAllowed) {
        this.runtime.schedule({
          id: crypto.randomUUID(),
          simulationId: event.simulationId,
          timestampMs: event.timestampMs + DEFAULT_RETRY_DELAY_MS,
          type: "request.retry",
          sourceNodeId: node.id,
          targetNodeId: node.id,
          payload: {
            requestId,
          },
        });

        return;
      }

      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.failed",
        sourceNodeId: node.id,
        targetNodeId: node.id,
        payload: {
          requestId,
          reason: "component_error",
        },
      });

      return;
    }

    // 7. Otherwise increment activeRequests
    this.runtime.incrementActiveRequests(event.sourceNodeId);

    // A started request may push utilization (or observed error/latency) over a
    // threshold, so reflect it in the component's health immediately.
    const healthTransition = this.runtime.evaluateComponentHealth(
      event.sourceNodeId,
    );

    if (healthTransition) {
      this.scheduleHealthChanged(
        event,
        event.sourceNodeId,
        healthTransition.previousHealth,
        healthTransition.health,
      );
    }

    const latencyMs = node.config.latencyMs ?? 0;

    // 8. Schedule processing_completed; the start timestamp lets the completion
    // handler compute the request's actual processing latency.
    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + latencyMs,
      type: "request.processing_completed",
      sourceNodeId: event.sourceNodeId,
      payload: {
        requestId,
        processingStartedAtMs: event.timestampMs,
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

    // The start timestamp is required to derive the real processing latency.
    const processingStartedAtMs = event.payload?.processingStartedAtMs;

    if (typeof processingStartedAtMs !== "number") {
      throw new Error(
        "request.processing_completed event requires processingStartedAtMs.",
      );
    }

    const sourceNodeId = event.sourceNodeId;

    if (!sourceNodeId) {
      throw new Error(
        "request.processing_completed event requires a sourceNodeId.",
      );
    }

    // Record actual latency, then free capacity and refresh health now that
    // utilization (and the latency/error history) has changed.
    const processingLatencyMs = event.timestampMs - processingStartedAtMs;
    this.runtime.recordProcessingLatency(sourceNodeId, processingLatencyMs);

    this.runtime.decrementActiveRequests(sourceNodeId);
    this.runtime.recordProcessedRequest(sourceNodeId);

    const healthTransition = this.runtime.evaluateComponentHealth(sourceNodeId);

    if (healthTransition) {
      this.scheduleHealthChanged(
        event,
        sourceNodeId,
        healthTransition.previousHealth,
        healthTransition.health,
      );
    }

    const queuedRequestId = this.runtime.dequeueRequest(sourceNodeId);

    if (queuedRequestId) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.processing_started",
        sourceNodeId: sourceNodeId,
        targetNodeId: sourceNodeId,
        payload: {
          requestId: queuedRequestId,
        },
      });
    }

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
  // request.failed
  // ---------------------------------------------------------------------------

  /**
   * Fails the request.
   */

  private handleRequestFailed(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    this.runtime.updateRequest(requestId, {
      status: "failed",
      failedAtMs: event.timestampMs,
    });
  }

  // ---------------------------------------------------------------------------
  // request.retry
  // ---------------------------------------------------------------------------

  private handleRequestRetry(event: SimulationEvent): void {
    const requestId = this.getRequestId(event);

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs,
      type: "request.processing_started",
      sourceNodeId: event.sourceNodeId,
      targetNodeId: event.targetNodeId,
      payload: {
        requestId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // component.failed
  // ---------------------------------------------------------------------------

  /**
   * Marks the source component as failed so it will reject requests submitted
   * from then on, emits a component.health_changed event for the transition, and
   * schedules an automatic recovery when the node configures a recoveryDelayMs.
   */
  private handleComponentFailed(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("component.failed event requires a sourceNodeId.");
    }

    const component = this.runtime.getComponent(nodeId);

    // The component is already failed. There is nothing new to do.
    if (component.health === "failed") {
      return;
    }

    const previousHealth = component.health;

    this.runtime.setComponentHealth(nodeId, "failed");

    this.scheduleHealthChanged(event, nodeId, previousHealth, "failed");

    this.scheduleRecovery(event, nodeId);
  }

  // ---------------------------------------------------------------------------
  // component.health_changed
  // ---------------------------------------------------------------------------

  /**
   * Observes a component health transition.
   *
   * The new health state is already applied by the operation that produced this
   * event; this handler exists only to make the transition observable.
   */
  private handleComponentHealthChanged(event: SimulationEvent): void {
    if (!event.sourceNodeId) {
      throw new Error(
        "component.health_changed event requires a sourceNodeId.",
      );
    }

    // Health has already been updated by the operation that caused
    // this event. This event exists to make the transition observable.
  }

  // ---------------------------------------------------------------------------
  // component.recovery
  // ---------------------------------------------------------------------------

  /**
   * Fires an automatic recovery target: schedules a component.recovered event
   * when the recovery generation still matches and the component is still
   * failed. Stale recovery events from an earlier failure/recovery cycle are
   * ignored so an old timer can never recover a component that has since failed
   * again or already recovered through another mechanism.
   */
  private handleComponentRecovery(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("component.recovery event requires a sourceNodeId.");
    }

    const recoveryGeneration = event.payload?.recoveryGeneration;

    if (typeof recoveryGeneration !== "number") {
      throw new Error(
        "component.recovery event requires a recoveryGeneration.",
      );
    }

    const component = this.runtime.getComponent(nodeId);

    // Ignore stale recovery events.
    if (component.recoveryGeneration !== recoveryGeneration) {
      return;
    }

    // The component may already have recovered through another mechanism.
    if (component.health !== "failed") {
      return;
    }

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs,
      type: "component.recovered",
      sourceNodeId: nodeId,
      payload: {
        recoveryGeneration,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // component.recovered
  // ---------------------------------------------------------------------------

  /**
   * Restores a failed component to healthy and emits a component.health_changed
   * event for the transition.
   *
   * Only acts when the component is currently failed; a component.recovered
   * event for a healthy/degraded/critical component is a no-op.
   */
  private handleComponentRecovered(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("component.recovered event requires a sourceNodeId.");
    }

    const component = this.runtime.getComponent(nodeId);

    if (component.health !== "failed") {
      return;
    }

    const previousHealth = component.health;

    this.runtime.setComponentHealth(nodeId, "healthy");

    this.scheduleHealthChanged(event, nodeId, previousHealth, "healthy");
  }

  // ---------------------------------------------------------------------------
  // autoscaling.evaluate
  // ---------------------------------------------------------------------------

  /**
   * Evaluates the component's current load and schedules a scaling event when
   * the utilization is outside the configured autoscaling target band.
   *
   * The next evaluation is always scheduled after the current evaluation,
   * making autoscaling periodic and simulation-time driven.
   */
  private handleAutoscalingEvaluate(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("autoscaling.evaluate event requires a sourceNodeId.");
    }

    this.autoscalingController.evaluate(event);

    this.autoscalingScheduler.scheduleNext(nodeId, event.timestampMs);
  }

  // ---------------------------------------------------------------------------
  // component.scaled
  // ---------------------------------------------------------------------------

  /**
   * Applies a previously evaluated autoscaling decision to the component's
   * runtime state.
   *
   * Scaling never cancels active requests. It only changes the capacity
   * available to subsequent processing attempts.
   */
  private handleComponentScaled(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("component.scaled event requires a sourceNodeId.");
    }

    const replicas = event.payload?.replicas;

    if (
      typeof replicas !== "number" ||
      !Number.isInteger(replicas) ||
      replicas < 1
    ) {
      throw new Error(
        "component.scaled event requires a positive integer replicas value.",
      );
    }

    const node = this.runtime.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const autoscaling = node.config.autoscaling;

    if (!autoscaling?.enabled) {
      return;
    }

    // The component may have failed between evaluation and application.
    // Do not scale a failed component.
    const component = this.runtime.getComponent(nodeId);

    if (component.health === "failed") {
      return;
    }

    if (replicas < autoscaling.min || replicas > autoscaling.max) {
      throw new Error(
        `Component ${nodeId} replicas ${replicas} are outside autoscaling bounds ` +
          `[${autoscaling.min}, ${autoscaling.max}].`,
      );
    }

    this.runtime.setComponentReplicas(nodeId, replicas);
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
    const requestId = this.getRequestId(event);

    if (edges.length === 0) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.completed",
        sourceNodeId,
        payload: {
          requestId,
        },
      });

      return;
    }

    const availableEdges = edges.filter((edge) =>
      this.runtime.isNodeAvailable(edge.target),
    );

    // Every destination is currently unavailable.
    if (availableEdges.length === 0) {
      this.runtime.schedule({
        id: crypto.randomUUID(),
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.failed",
        sourceNodeId,
        payload: {
          requestId,
          reason: "no_available_destination",
        },
      });

      return;
    }

    let selectedEdge: ArchitectureEdge;

    // Fast path: one outgoing edge means the choice is trivial — skip the
    // strategy lookup entirely.
    if (availableEdges.length === 1) {
      selectedEdge = availableEdges[0]!;
    } else {
      const routingStrategy = this.runtime.getRoutingStrategy(sourceNodeId);
      selectedEdge = routingStrategy.selectEdge(
        availableEdges,
        this.runtime.getRoutingContext(sourceNodeId, requestId),
      );
    }

    const networkLatencyMs = getNetworkLatency(selectedEdge);

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs + networkLatencyMs,
      type: "request.routed",
      sourceNodeId: selectedEdge.source,
      targetNodeId: selectedEdge.target,
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
   * Schedules the component.health_changed event that makes a health transition
   * observable in the event stream.
   */
  private scheduleHealthChanged(
    event: SimulationEvent,
    nodeId: string,
    previousHealth: ComponentRuntimeState["health"],
    health: ComponentRuntimeState["health"],
  ): void {
    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs,
      type: "component.health_changed",
      sourceNodeId: nodeId,
      payload: {
        previousHealth,
        health,
      },
    });
  }

  /**
   * Schedules automatic recovery for a failed component that declares a
   * recoveryDelayMs in its config.
   *
   * Each failure starts a new recovery cycle, so previously scheduled recovery
   * events become stale and are discarded when they eventually fire. The
   * component.recovery_scheduled event is observability-only and has no handler.
   */
  private scheduleRecovery(event: SimulationEvent, nodeId: string): void {
    const node = this.runtime.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const recoveryDelayMs = node.config.recoveryDelayMs;

    // Undefined means automatic recovery is disabled.
    if (recoveryDelayMs === undefined) {
      return;
    }

    if (recoveryDelayMs < 0) {
      throw new Error(`Recovery delay cannot be negative: ${recoveryDelayMs}`);
    }

    const recoveryGeneration = this.runtime.startRecoveryCycle(nodeId);

    const recoveryTimestampMs = event.timestampMs + recoveryDelayMs;

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: recoveryTimestampMs,
      type: "component.recovery_scheduled",
      sourceNodeId: nodeId,
      payload: {
        recoveryGeneration,
        recoveryAtMs: recoveryTimestampMs,
      },
    });

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: recoveryTimestampMs,
      type: "component.recovery",
      sourceNodeId: nodeId,
      payload: {
        recoveryGeneration,
      },
    });
  }
}
