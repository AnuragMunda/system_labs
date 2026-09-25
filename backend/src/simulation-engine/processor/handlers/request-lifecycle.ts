/**
 * @file request-lifecycle.ts
 *
 * @description Handlers for the request lifecycle events: creation, routing,
 * processing, completion, failure, and retry. Together they move a request
 * through the architecture's topology.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";
import type { ArchitectureEdge } from "@/domain/architecture/connection.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import {
  createEvent,
  getNetworkLatency,
  canRetry,
  shouldFail,
} from "../../utils/helpers.js";
import {
  DEFAULT_REQUEST_SIZE_BYTES,
  DEFAULT_RETRY_DELAY_MS,
} from "../../utils/constants.js";
import { getRequestId, scheduleHealthChanged } from "./event-handling.js";

/** Handlers for the `request.*` event types. */
export class RequestLifecycleHandlers {
  constructor(private readonly runtime: SimulationRuntime) {}

  // ---------------------------------------------------------------------------
  // request.created
  // ---------------------------------------------------------------------------

  /**
   * Updates the newly created request and determines its first destination
   * from the architecture topology.
   */
  handleCreated(event: SimulationEvent): void {
    const requestId = getRequestId(event);

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
  handleRouted(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    if (!event.targetNodeId) {
      throw new Error("request.routed event requires a targetNodeId.");
    }

    this.runtime.updateRequest(requestId, {
      status: "in-flight",
      currentNodeId: event.targetNodeId,
    });

    if (this.runtime.isCacheNode(event.targetNodeId)) {
      this.handleCacheLookup(event, event.targetNodeId, requestId);
      return;
    }

    if (this.runtime.isDatabaseNode(event.targetNodeId)) {
      this.handleDatabaseArrival(event, event.targetNodeId, requestId);
      return;
    }

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.processing_started",
        sourceNodeId: event.targetNodeId,
        targetNodeId: event.targetNodeId,
        payload: {
          requestId,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // request.processing_started
  // ---------------------------------------------------------------------------

  handleProcessingStarted(event: SimulationEvent): void {
    const requestId = getRequestId(event);
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
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.failed",
          sourceNodeId: event.sourceNodeId,
          payload: {
            requestId,
            reason: "component_failed",
          },
        }),
      );

      return;
    }

    // 3. Admit to the component queue when there is no remaining capacity.
    //
    //    Admission is delegated to the runtime, which applies the component's
    //    `queue` configuration:
    //    - admitted           → the request is marked "queued" and a
    //                           `queue.enqueue` event is emitted.
    //    - admitted with drop → with `overflowStrategy: "drop_oldest"` the
    //                           front-most request is evicted and failed with
    //                           reason "queue_overflow".
    //    - rejected           → the request fails with reason "queue_overflow"
    //                           (a full queue) or "queue_disabled" (a queue
    //                           that is explicitly disabled).
    if (!this.runtime.hasCapacity(event.sourceNodeId)) {
      const admission = this.runtime.enqueueRequest(
        event.sourceNodeId,
        requestId,
      );

      if (admission.admitted) {
        this.runtime.updateRequest(requestId, {
          status: "queued",
          currentNodeId: event.sourceNodeId,
        });

        this.runtime.schedule(
          createEvent({
            simulationId: event.simulationId,
            timestampMs: event.timestampMs,
            type: "queue.enqueue",
            sourceNodeId: event.sourceNodeId,
            payload: {
              requestId,
            },
          }),
        );

        if (admission.droppedRequestId) {
          this.runtime.schedule(
            createEvent({
              simulationId: event.simulationId,
              timestampMs: event.timestampMs,
              type: "request.failed",
              sourceNodeId: event.sourceNodeId,
              payload: {
                requestId: admission.droppedRequestId,
                reason: "queue_overflow",
              },
            }),
          );
        }

        return;
      }

      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.failed",
          sourceNodeId: event.sourceNodeId,
          payload: {
            requestId,
            reason:
              admission.reason === "queue_full"
                ? "queue_overflow"
                : "queue_disabled",
          },
        }),
      );

      return;
    }

    // 4. Increment attempt
    const currentAttempt = request.attempts + 1;

    this.runtime.updateRequest(requestId, {
      status: "in-flight",
      currentNodeId: event.sourceNodeId,
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
        this.runtime.schedule(
          createEvent({
            simulationId: event.simulationId,
            timestampMs: event.timestampMs + DEFAULT_RETRY_DELAY_MS,
            type: "request.retry",
            sourceNodeId: node.id,
            targetNodeId: node.id,
            payload: {
              requestId,
            },
          }),
        );

        return;
      }

      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.failed",
          sourceNodeId: node.id,
          targetNodeId: node.id,
          payload: {
            requestId,
            reason: "component_error",
          },
        }),
      );

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
      scheduleHealthChanged(
        this.runtime,
        event,
        event.sourceNodeId,
        healthTransition.previousHealth,
        healthTransition.health,
      );
    }

    const latencyMs = node.config.latencyMs ?? 0;

    // The miss context lives on the request (set on cache.miss), so it
    // survives retries and queue admission; forward it as observability on
    // the completion event too.
    const cacheMiss = request.cacheMiss === true;

    // 8. Schedule processing_completed; the start timestamp lets the completion
    // handler compute the request's actual processing latency.
    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs + latencyMs,
        type: "request.processing_completed",
        sourceNodeId: event.sourceNodeId,
        payload: {
          requestId,
          processingStartedAtMs: event.timestampMs,
          cacheMiss,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // request.processing_completed
  // ---------------------------------------------------------------------------

  /**
   * Finalizes processing on the current component and moves the request
   * toward the next component. Routing is applied inline (rather than via
   * routeRequest) so the network latency of the outgoing connection is
   * accounted for, or the request is completed at a terminal component.
   *
   * A request that missed a cache lookup runs the same bookkeeping as any
   * other processing (latency, capacity, health, queue drain) before it stores
   * the fetched value via `cache.set` and completes at the cache.
   *
   * Any queued requests are started again via a `queue.drain` event once the
   * freed capacity is available.
   */
  handleProcessingCompleted(event: SimulationEvent): void {
    // Validates that the event carries a requestId.
    const requestId = getRequestId(event);

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
      scheduleHealthChanged(
        this.runtime,
        event,
        sourceNodeId,
        healthTransition.previousHealth,
        healthTransition.health,
      );
    }

    // The freed capacity is offered to any queued requests. Draining is
    // delegated to the `handleQueueDrain` handler via a `queue.drain` event
    // (rather than done inline) so the drain observes the same simulation
    // clock as every other transition. Skip the event when nothing is queued.
    if (this.runtime.getQueuedRequestCount(sourceNodeId) > 0) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "queue.drain",
          sourceNodeId,
        }),
      );
    }

    // A completed cache miss stores the fetched value and completes at the
    // cache instead of routing onward. The miss context is read from the
    // request so it stays correct even when processing started via a retry or
    // a queue drain.
    const request = this.runtime.getRequest(requestId);

    if (request.cacheMiss === true && this.runtime.isCacheNode(sourceNodeId)) {
      this.scheduleCacheSet(event, sourceNodeId);

      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.completed",
          sourceNodeId,
          payload: {
            requestId,
            cacheMiss: true,
          },
        }),
      );

      return;
    }

    // A completed database operation is surfaced as a `database.response`
    // event before normal routing, so the operation's result is observable in
    // the event stream. Routing is delegated to the response handler, keeping
    // the database completion bookkeeping in a single place.
    if (this.runtime.isDatabaseNode(sourceNodeId)) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "database.response",
          sourceNodeId,
          payload: {
            requestId,
            databaseOperation: request.databaseOperation ?? "read",
          },
        }),
      );

      return;
    }

    this.routeRequest(event, sourceNodeId);
  }

  // ---------------------------------------------------------------------------
  // queue.drain
  // ---------------------------------------------------------------------------

  /**
   * Starts the next queued requests once capacity becomes available again.
   *
   * Drains the component's FIFO queue while the component is healthy, emitting
   * a `queue.dequeue` and a `request.processing_started` event for every
   * request started. The drain is bounded by the capacity available at the
   * time the event fires, so only requests that will actually start are
   * dequeued.
   */
  handleQueueDrain(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("queue.drain event requires a sourceNodeId.");
    }

    const component = this.runtime.getComponent(nodeId);

    // A failed component cannot process the queued requests.
    if (component.health === "failed") {
      return;
    }

    const availableSlots =
      this.runtime.getEffectiveConcurrency(nodeId) -
      this.runtime.getActiveRequestCount(nodeId);

    let started = 0;

    while (
      started < availableSlots &&
      this.runtime.getQueuedRequestCount(nodeId) > 0
    ) {
      const requestId = this.runtime.dequeueRequest(nodeId);

      if (!requestId) {
        break;
      }

      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "queue.dequeue",
          sourceNodeId: nodeId,
          payload: {
            requestId,
          },
        }),
      );

      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.processing_started",
          sourceNodeId: nodeId,
          targetNodeId: nodeId,
          payload: {
            requestId,
          },
        }),
      );

      started += 1;
    }
  }

  // ---------------------------------------------------------------------------
  // request.completed
  // ---------------------------------------------------------------------------

  /**
   * Completes the request.
   */
  handleCompleted(event: SimulationEvent): void {
    const requestId = getRequestId(event);

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

  handleFailed(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    this.runtime.updateRequest(requestId, {
      status: "failed",
      failedAtMs: event.timestampMs,
    });
  }

  // ---------------------------------------------------------------------------
  // request.retry
  // ---------------------------------------------------------------------------

  handleRetry(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    // A network-level retry re-runs the routing from the transmitting node so
    // a new transmission is attempted over the connection. Everything else
    // re-attempts processing at the component that just failed.
    if (event.payload?.stage === "network") {
      this.routeRequest(event, event.sourceNodeId!);

      return;
    }

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.processing_started",
        sourceNodeId: event.sourceNodeId,
        targetNodeId: event.targetNodeId,
        payload: {
          requestId,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Determines where a request should go next based on the outgoing
   * connections of its current component.
   *
   * Routing answers only one question: which connection should the request
   * use? The network transmission itself — how long delivery takes and whether
   * it succeeds — is handled by the `network.transmission_started` handler, so
   * latency and packet-loss behavior live with the network simulation rather
   * than alongside the routing decision.
   *
   * Routing rules for the current MVP:
   *
   * 0 outgoing edges → request.completed (no routing performed)
   * >= 1 outgoing edge → select one via the runtime's routing strategy, then a
   *                      network.transmission_started event for that edge
   */

  public routeRequest(event: SimulationEvent, sourceNodeId: string): void {
    const edges = this.runtime.topology.getOutgoingEdges(sourceNodeId);
    const requestId = getRequestId(event);

    if (edges.length === 0) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.completed",
          sourceNodeId,
          payload: {
            requestId,
          },
        }),
      );

      return;
    }

    const availableEdges = edges.filter((edge) =>
      this.runtime.isNodeAvailable(edge.target),
    );

    // Every destination is currently unavailable.
    if (availableEdges.length === 0) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.failed",
          sourceNodeId,
          payload: {
            requestId,
            reason: "no_available_destination",
          },
        }),
      );

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

    const edge = selectedEdge;
    const sizeBytes =
      this.runtime.getRequest(requestId).sizeBytes ??
      DEFAULT_REQUEST_SIZE_BYTES;

    // Emit the network transmission for the chosen connection. The network
    // handler simulates delivery (latency + bandwidth transmission time) and
    // schedules the request.routed arrival — or failures the request when the
    // transmission is lost. Routing and transmission remain separate.
    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "network.transmission_started",
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        payload: {
          requestId,
          edgeId: edge.id,
          protocol: edge.config.protocol,
          sizeBytes,
          latencyMs: getNetworkLatency(edge),
          bandwidthMbps: edge.config.bandwidthMbps,
          packetLossRate: edge.config.packetLossRate,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Database Helpers
  // ---------------------------------------------------------------------------

  /**
   * Emits the `database.request` event when a request arrives at a database
   * node, so the operation is processed through the database's capacity-bound
   * path before its result is surfaced via `database.response`.
   */
  private handleDatabaseArrival(
    event: SimulationEvent,
    nodeId: string,
    requestId: string,
  ): void {
    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "database.request",
        sourceNodeId: nodeId,
        targetNodeId: nodeId,
        payload: {
          requestId,
        },
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Cache Helpers
  // ---------------------------------------------------------------------------

  private handleCacheLookup(
    event: SimulationEvent,
    nodeId: string,
    requestId: string,
  ): void {
    // A failed cache can serve neither path. Closing the window where the
    // node fails after `request.routed` but before this lookup runs.
    const component = this.runtime.getComponent(nodeId);

    if (component.health === "failed") {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "request.failed",
          sourceNodeId: nodeId,
          payload: {
            requestId,
            reason: "component_failed",
          },
        }),
      );

      return;
    }

    const cacheKey = this.runtime.getRequest(requestId).cacheKey;

    if (typeof cacheKey !== "string") {
      throw new Error(
        `Request ${requestId} reached cache ${nodeId} without a cacheKey.`,
      );
    }

    const entry = this.runtime.getCacheEntry(nodeId, cacheKey);

    const node = this.runtime.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const hitLatencyMs =
      node.config.cache?.hitLatencyMs ?? node.config.latencyMs ?? 0;

    const missLatencyMs =
      node.config.cache?.missLatencyMs ?? node.config.latencyMs ?? 0;

    if (entry) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs + hitLatencyMs,
          type: "cache.hit",
          sourceNodeId: nodeId,
          targetNodeId: nodeId,
          payload: {
            requestId,
            cacheKey,
          },
        }),
      );

      return;
    }

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs + missLatencyMs,
        type: "cache.miss",
        sourceNodeId: nodeId,
        targetNodeId: nodeId,
        payload: {
          requestId,
          cacheKey,
        },
      }),
    );
  }

  private scheduleCacheSet(event: SimulationEvent, nodeId: string): void {
    const requestId = getRequestId(event);

    const cacheKey = this.runtime.getRequest(requestId).cacheKey;

    if (typeof cacheKey !== "string") {
      throw new Error(
        `Request ${requestId} missed cache ${nodeId} without a cacheKey.`,
      );
    }

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "cache.set",
        sourceNodeId: nodeId,
        targetNodeId: nodeId,
        payload: {
          requestId,
          cacheKey,
          value: {
            requestId,
          },
        },
      }),
    );
  }
}
