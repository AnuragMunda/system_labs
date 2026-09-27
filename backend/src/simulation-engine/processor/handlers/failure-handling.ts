/**
 * @file failure-handling.ts
 *
 * @description Unified retry/failure handling shared by the processing and
 * network paths.
 *
 * A retryable failure is recorded against the target component's circuit
 * breaker (triping the circuit open once the configured consecutive-failure
 * threshold is reached), then the request is retried according to its retry
 * policy or failed permanently. Terminal failures fail the request directly
 * without any circuit accounting; a terminal failure that owns the half-open
 * probe releases it so the circuit does not wedge.
 *
 * The failure classification (a {@link FailureKind}) drives retryability and
 * circuit accounting; the emitted `reason` string keeps the legacy event
 * stream contract (for example a `processing_error` is emitted as
 * `component_error`).
 */

import type { FailureKind } from "@/domain/architecture/component.types.js";
import type { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import { canRetry, createEvent } from "../../utils/helpers.js";
import { DEFAULT_RETRY_DELAY_MS } from "../../utils/constants.js";

/** The retryable subset of {@link FailureKind}. */
export type RetryableFailureKind = Extract<
  FailureKind,
  "processing_error" | "network_packet_loss"
>;

const REASON_FOR_RETRYABLE_KIND: Record<RetryableFailureKind, string> = {
  processing_error: "component_error",
  network_packet_loss: "network_packet_loss",
};

export interface RetryableFailureOptions {
  event: SimulationEvent;
  requestId: string;
  /** The node whose circuit the failure is recorded against. */
  targetNodeId: string;
  /** The node whose retry policy governs the retry decision. */
  retryNodeId: string;
  /** The 1-based attempt number of the failed attempt. */
  currentAttempt: number;
  kind: RetryableFailureKind;
  /** Simulation time at which the failure is known. */
  failureAtMs: number;
  /** Retries re-run routing from the transmitting node when set. */
  stage?: "network";
}

export interface TerminalFailureOptions {
  event: SimulationEvent;
  requestId: string;
  sourceNodeId: string;
  targetNodeId?: string;
  reason: string;
  timestampMs?: number;
  /** When the failing request owns this node's half-open probe, release it. */
  probeNodeId?: string;
}

/** Line 1: unified retry/failure handling for the simulation engine. */
export class FailureHandler {
  constructor(private readonly runtime: SimulationRuntime) {}

  /**
   * Handles a retryable failure (processing error or network packet loss):
   * records it against the target component's circuit, emits circuit events
   * when the breaker trips, then retries or permanently fails the request.
   *
   * Attempt bookkeeping (`attempts` increment) stays at the call site so the
   * attempt semantics are not duplicated here.
   */
  handleRetryableFailure(options: RetryableFailureOptions): void {
    const {
      event,
      requestId,
      targetNodeId,
      retryNodeId,
      currentAttempt,
      kind,
      failureAtMs,
      stage,
    } = options;

    const circuitRecord = this.runtime.recordCircuitFailure(targetNodeId);

    if (
      circuitRecord &&
      circuitRecord.opened &&
      circuitRecord.openedAtMs !== undefined
    ) {
      this.scheduleCircuitOpened(event, targetNodeId, {
        consecutiveFailures: circuitRecord.consecutiveFailures,
        failureThreshold: circuitRecord.failureThreshold,
        openedAtMs: circuitRecord.openedAtMs,
        generation: circuitRecord.generation,
      });
    }

    const retryNode = this.runtime.topology.getNode(retryNodeId);

    if (!retryNode) {
      throw new Error(`Node not found: ${retryNodeId}`);
    }

    const maxRetries = retryNode.config.retryPolicy?.retries ?? 0;

    if (canRetry(currentAttempt, maxRetries)) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: failureAtMs + DEFAULT_RETRY_DELAY_MS,
          type: "request.retry",
          sourceNodeId: retryNodeId,
          targetNodeId,
          payload: stage ? { requestId, stage } : { requestId },
        }),
      );

      return;
    }

    this.scheduleTerminalFailure({
      event,
      requestId,
      sourceNodeId: retryNodeId,
      targetNodeId,
      timestampMs: failureAtMs,
      reason: REASON_FOR_RETRYABLE_KIND[kind],
    });
  }

  /**
   * Fails a request permanently. No circuit accounting happens here except
   * releasing a half-open probe the failing request owns.
   */
  scheduleTerminalFailure(options: TerminalFailureOptions): void {
    const { event, requestId, sourceNodeId, reason } = options;

    const targetNodeId = options.targetNodeId ?? sourceNodeId;
    const timestampMs = options.timestampMs ?? event.timestampMs;

    const probeNodeId = options.probeNodeId;

    if (
      probeNodeId !== undefined &&
      this.runtime.isCircuitProbe(probeNodeId, requestId)
    ) {
      this.runtime.releaseProbe(probeNodeId);
    }

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs,
        type: "request.failed",
        sourceNodeId,
        targetNodeId,
        payload: {
          requestId,
          reason,
        },
      }),
    );
  }

  /**
   * Resets a component's circuit after a successful execution, emitting a
   * `component.circuit_closed` event when a half-open probe succeeded (the
   * only path that actually closes an open circuit).
   */
  closeCircuit(nodeId: string, event: SimulationEvent): void {
    if (this.runtime.resetCircuit(nodeId)) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "component.circuit_closed",
          sourceNodeId: nodeId,
        }),
      );
    }
  }

  /**
   * Emits the `component.circuit_opened` event and schedules the automatic
   * `component.circuit_half_open` transition once the open duration elapses.
   * The transition is generation-guarded by the runtime.
   */
  private scheduleCircuitOpened(
    event: SimulationEvent,
    nodeId: string,
    record: {
      consecutiveFailures: number;
      failureThreshold: number;
      openedAtMs: number;
      generation: number;
    },
  ): void {
    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "component.circuit_opened",
        sourceNodeId: nodeId,
        payload: {
          failureCount: record.consecutiveFailures,
          threshold: record.failureThreshold,
          openedAtMs: record.openedAtMs,
          generation: record.generation,
        },
      }),
    );

    const openDurationMs = this.runtime.getCircuitState(nodeId).openDurationMs;

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: record.openedAtMs + openDurationMs,
        type: "component.circuit_half_open",
        sourceNodeId: nodeId,
        payload: {
          generation: record.generation,
        },
      }),
    );
  }
}
