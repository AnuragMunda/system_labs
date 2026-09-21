/**
 * @file component-lifecycle.ts
 *
 * @description Handlers for the component lifecycle events: failures, automatic
 * recovery, and the observability-only health transition events.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import { createEvent } from "../../utils/helpers.js";
import { scheduleHealthChanged } from "./event-handling.js";

/** Handlers for the `component.*` event types. */
export class ComponentLifecycleHandlers {
  constructor(private readonly runtime: SimulationRuntime) {}

  // ---------------------------------------------------------------------------
  // component.failed
  // ---------------------------------------------------------------------------

  /**
   * Marks the source component as failed so it will reject requests submitted
   * from then on, emits a component.health_changed event for the transition, and
   * schedules an automatic recovery when the node configures a recoveryDelayMs.
   */
  handleFailed(event: SimulationEvent): void {
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

    scheduleHealthChanged(
      this.runtime,
      event,
      nodeId,
      previousHealth,
      "failed",
    );

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
  handleHealthChanged(event: SimulationEvent): void {
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
  handleRecovery(event: SimulationEvent): void {
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

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "component.recovered",
        sourceNodeId: nodeId,
        payload: {
          recoveryGeneration,
        },
      }),
    );
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
  handleRecovered(event: SimulationEvent): void {
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

    scheduleHealthChanged(
      this.runtime,
      event,
      nodeId,
      previousHealth,
      "healthy",
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: recoveryTimestampMs,
        type: "component.recovery_scheduled",
        sourceNodeId: nodeId,
        payload: {
          recoveryGeneration,
          recoveryAtMs: recoveryTimestampMs,
        },
      }),
    );

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: recoveryTimestampMs,
        type: "component.recovery",
        sourceNodeId: nodeId,
        payload: {
          recoveryGeneration,
        },
      }),
    );
  }
}
