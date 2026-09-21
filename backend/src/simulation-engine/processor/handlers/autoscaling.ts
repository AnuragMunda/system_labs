/**
 * @file autoscaling.ts
 *
 * @description Handlers for the autoscaling events: evaluating a component's
 * load and applying the resulting scale decisions.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import { AutoscalingController } from "../../autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "../../autoscaling/autoscaling-scheduler.js";
import { createEvent } from "../../utils/helpers.js";

/** Handlers for the `autoscaling.evaluate` and `component.scaled` events. */
export class AutoscalingHandlers {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly autoscalingController: AutoscalingController,
    private readonly autoscalingScheduler: AutoscalingScheduler,
  ) {}

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
  handleEvaluate(event: SimulationEvent): void {
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
  handleScaled(event: SimulationEvent): void {
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

    const previousReplicas = component.replicas;

    this.runtime.setComponentReplicas(nodeId, replicas);

    // A scale-up frees capacity for requests that are already queued, so offer
    // it to them. Draining is handled by the request lifecycle's
    // `handleQueueDrain`. Skip the event when nothing is queued.
    if (
      replicas > previousReplicas &&
      this.runtime.getQueuedRequestCount(nodeId) > 0
    ) {
      this.runtime.schedule(
        createEvent({
          simulationId: event.simulationId,
          timestampMs: event.timestampMs,
          type: "queue.drain",
          sourceNodeId: nodeId,
        }),
      );
    }
  }
}
