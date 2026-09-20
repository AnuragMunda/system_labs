/**
 * @file autoscaling-controller.ts
 *
 * @description Decides when an autoscaling-enabled component should scale. The
 * controller is decision-only: it reads runtime state and schedules
 * component.scaled events, leaving the state mutation to the event processor.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { SimulationRuntime } from "../core/simulation-runtime.js";
import { getEffectiveConcurrency } from "../helper.js";

const AUTOSCALING_DEADBAND_PERCENT = 10;

export class AutoscalingController {
  constructor(private readonly runtime: SimulationRuntime) {}

  /**
   * Evaluates autoscaling for a component and schedules a scaling event
   * when the current utilization is outside the configured target band.
   *
   * The controller never mutates replica state directly. Replica changes
   * are applied by the component.scaled event in the event processor.
   */
  evaluate(event: SimulationEvent): void {
    const nodeId = event.sourceNodeId;

    if (!nodeId) {
      throw new Error("autoscaling.evaluate event requires a sourceNodeId.");
    }

    const node = this.runtime.topology.getNode(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const autoscaling = node.config.autoscaling;

    // Autoscaling is opt-in.
    if (!autoscaling?.enabled) {
      return;
    }

    const component = this.runtime.getComponent(nodeId);

    // Failed components do not participate in autoscaling.
    // They resume automatically on the next evaluation after recovery.
    if (component.health === "failed") {
      return;
    }

    const effectiveConcurrency = this.runtime.getEffectiveConcurrency(nodeId);

    if (effectiveConcurrency <= 0) {
      return;
    }

    const utilization = (component.activeRequests / effectiveConcurrency) * 100;

    const upperThreshold = autoscaling.targetCpu + AUTOSCALING_DEADBAND_PERCENT;

    const lowerThreshold = autoscaling.targetCpu - AUTOSCALING_DEADBAND_PERCENT;

    let nextReplicas = component.replicas;

    if (utilization > upperThreshold) {
      nextReplicas = component.replicas + 1;
    } else if (utilization < lowerThreshold) {
      nextReplicas = component.replicas - 1;
    }

    // Respect autoscaling boundaries.
    nextReplicas = Math.max(
      autoscaling.min,
      Math.min(autoscaling.max, nextReplicas),
    );

    if (nextReplicas === component.replicas) {
      return;
    }

    // Scale-down must never reduce capacity below the number of currently
    // active requests. Defer the decision until enough capacity is free.
    if (nextReplicas < component.replicas) {
      const concurrency = node.config.concurrency ?? 1;
      const nextEffectiveConcurrency = getEffectiveConcurrency(
        nextReplicas,
        concurrency,
      );

      if (nextEffectiveConcurrency < component.activeRequests) {
        return;
      }
    }

    this.runtime.schedule({
      id: crypto.randomUUID(),
      simulationId: event.simulationId,
      timestampMs: event.timestampMs,
      type: "component.scaled",
      sourceNodeId: nodeId,
      payload: {
        previousReplicas: component.replicas,
        replicas: nextReplicas,
        utilization,
        targetCpu: autoscaling.targetCpu,
        reason: "cpu_target",
      },
    });
  }
}
