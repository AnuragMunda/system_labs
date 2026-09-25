/**
 * @file network-handling.ts
 *
 * @description Handlers for the network transmission events emitted when a
 * request is routed across a connection.
 *
 * Routing answers only which connection a request should use; the network
 * simulation decides how long delivery takes and whether it succeeds. A
 * `network.transmission_started` event is emitted for every hop. This handler
 * computes the delivery delay — the configured latency plus a
 * bandwidth-derived transmission time — and either delivers the request to
 * its destination via `request.routed` or fails/retries it when the
 * transmission is lost according to the connection's packet-loss rate.
 *
 * The delivery-rate approximation is deliberately request-level: it does not
 * model individual packets, congestion control, or retransmission algorithms.
 */

import type { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import type { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import {
  canRetry,
  createEvent,
  getNetworkLatency,
  getTransmissionTimeMs,
  shouldFail,
} from "../../utils/helpers.js";
import {
  DEFAULT_REQUEST_SIZE_BYTES,
  DEFAULT_RETRY_DELAY_MS,
} from "../../utils/constants.js";
import { getRequestId } from "./event-handling.js";

/** Handlers for the `network.*` event types. */
export class NetworkHandlers {
  constructor(private readonly runtime: SimulationRuntime) {}

  /**
   * Simulates the transmission of a request across the connection selected by
   * routing.
   *
   * The delivery delay is `latencyMs` plus the time it takes to push the
   * request's payload across the connection's bandwidth. When the connection
   * has a packet-loss rate, a PRNG draw decides whether the transmission is
   * lost; a lost transmission follows the existing retry/failure system (a
   * `request.retry` re-runs routing, or the request fails permanently with
   * reason `network_packet_loss`). A delivered transmission schedules the
   * request's arrival via `request.routed` after the total delay.
   */
  handleTransmission(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    if (!event.sourceNodeId || !event.targetNodeId) {
      throw new Error(
        "network.transmission_started event requires source and target node ids.",
      );
    }

    const edge = this.runtime.topology.getEdge(
      event.sourceNodeId,
      event.targetNodeId,
    );

    if (!edge) {
      throw new Error(
        `network.transmission_started event references ${event.sourceNodeId} → ${event.targetNodeId}, but no such connection exists.`,
      );
    }

    // Delivery delay = configured latency + bandwidth transmission time.
    const latencyMs = getNetworkLatency(edge);

    const bandwidthMbps = edge.config.bandwidthMbps;

    const sizeBytes =
      this.runtime.getRequest(requestId).sizeBytes ??
      DEFAULT_REQUEST_SIZE_BYTES;

    const transmissionTimeMs =
      bandwidthMbps === undefined
        ? 0
        : getTransmissionTimeMs(sizeBytes, bandwidthMbps);

    const totalDelayMs = latencyMs + transmissionTimeMs;

    const packetLossRate = edge.config.packetLossRate;

    const lost = this.isTransmissionLost(packetLossRate);

    if (lost) {
      this.handleLostTransmission(event, edge, latencyMs);

      return;
    }

    // Delivered: the request arrives at the destination after the total delay.
    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs + totalDelayMs,
        type: "request.routed",
        sourceNodeId: event.sourceNodeId,
        targetNodeId: event.targetNodeId,
        payload: {
          requestId,
        },
      }),
    );
  }

  /**
   * Resolves whether a transmission is lost given a packet-loss rate.
   *
   * Only a configured, strict rate consumes a draw from the simulation's
   * PRNG, so connections without packet loss leave the shared random stream
   * untouched and deterministic simulation behavior is preserved.
   */
  private isTransmissionLost(packetLossRate: number | undefined): boolean {
    if (packetLossRate === undefined) {
      return false;
    }

    if (packetLossRate === 1) {
      return true;
    }

    if (packetLossRate === 0) {
      return false;
    }

    return shouldFail(packetLossRate, this.runtime.random.next());
  }

  /**
   * Handles a lost transmission through the existing request failure/retry
   * system.
   *
   * The loss consumes the request's shared attempt budget and is governed by
   * the transmitting node's `retryPolicy`. When retries remain, a
   * `request.retry` (stage `"network"`) is scheduled so routing re-runs and a
   * fresh transmission is attempted; otherwise the request fails permanently
   * with reason `network_packet_loss`. Failure of a lost transmission is
   * detected once the configured latency window elapses.
   */
  private handleLostTransmission(
    event: SimulationEvent,
    edge: ArchitectureEdge,
    latencyMs: number,
  ): void {
    const requestId = getRequestId(event);

    const currentAttempt = this.runtime.getRequest(requestId).attempts + 1;

    this.runtime.updateRequest(requestId, { attempts: currentAttempt });

    const sourceNode = this.runtime.topology.getNode(event.sourceNodeId!);

    if (!sourceNode) {
      throw new Error(`Node not found: ${event.sourceNodeId}`);
    }

    const retryPolicy = sourceNode.config.retryPolicy;

    const retryAllowed = canRetry(currentAttempt, retryPolicy?.retries ?? 0);

    const failedAtMs = event.timestampMs + latencyMs;

    if (retryAllowed) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: failedAtMs + DEFAULT_RETRY_DELAY_MS,
          type: "request.retry",
          sourceNodeId: edge.source,
          targetNodeId: edge.target,
          payload: {
            requestId,
            stage: "network",
          },
        }),
      );

      return;
    }

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: failedAtMs,
        type: "request.failed",
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        payload: {
          requestId,
          reason: "network_packet_loss",
        },
      }),
    );
  }
}
