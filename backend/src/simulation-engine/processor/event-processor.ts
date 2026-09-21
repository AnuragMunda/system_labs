/**
 * @file event-processor.ts
 *
 * @description The default event processor. It acts as a thin dispatcher:
 * each event type is delegated to a dedicated handler module, which converts
 * the event into request state transitions in the runtime and schedules
 * follow-up events, routing every request through the topology until it
 * completes. Event semantics live in the modules under `./handlers`.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRuntime } from "../core/simulation-runtime.js";
import { EventProcessor } from "../utils/types.js";
import { AutoscalingController } from "../autoscaling/autoscaling-controller.js";
import { AutoscalingScheduler } from "../autoscaling/autoscaling-scheduler.js";
import { RequestLifecycleHandlers } from "./handlers/request-lifecycle.js";
import { ComponentLifecycleHandlers } from "./handlers/component-lifecycle.js";
import { AutoscalingHandlers } from "./handlers/autoscaling.js";

export class DefaultEventProcessor implements EventProcessor {
  private readonly requestHandlers: RequestLifecycleHandlers;
  private readonly componentHandlers: ComponentLifecycleHandlers;
  private readonly autoscalingHandlers: AutoscalingHandlers;

  constructor(
    runtime: SimulationRuntime,
    autoscalingController: AutoscalingController,
    autoscalingScheduler: AutoscalingScheduler,
  ) {
    this.requestHandlers = new RequestLifecycleHandlers(runtime);
    this.componentHandlers = new ComponentLifecycleHandlers(runtime);
    this.autoscalingHandlers = new AutoscalingHandlers(
      runtime,
      autoscalingController,
      autoscalingScheduler,
    );
  }

  process(event: SimulationEvent): void {
    switch (event.type) {
      case "request.created":
        this.requestHandlers.handleCreated(event);
        break;

      case "request.routed":
        this.requestHandlers.handleRouted(event);
        break;

      case "request.processing_started":
        this.requestHandlers.handleProcessingStarted(event);
        break;

      case "request.processing_completed":
        this.requestHandlers.handleProcessingCompleted(event);
        break;

      case "request.completed":
        this.requestHandlers.handleCompleted(event);
        break;

      case "request.failed":
        this.requestHandlers.handleFailed(event);
        break;

      case "request.retry":
        this.requestHandlers.handleRetry(event);
        break;

      case "component.failed":
        this.componentHandlers.handleFailed(event);
        break;

      case "component.recovery":
        this.componentHandlers.handleRecovery(event);
        break;

      case "component.recovered":
        this.componentHandlers.handleRecovered(event);
        break;

      case "component.health_changed":
        this.componentHandlers.handleHealthChanged(event);
        break;

      // component.recovery_scheduled is observability-only and intentionally
      // has no handler; it shares the timestamp and payload data of the
      // component.recovery event it accompanies.

      case "autoscaling.evaluate":
        this.autoscalingHandlers.handleEvaluate(event);
        break;

      case "component.scaled":
        this.autoscalingHandlers.handleScaled(event);
        break;

      default:
        break;
    }
  }
}
