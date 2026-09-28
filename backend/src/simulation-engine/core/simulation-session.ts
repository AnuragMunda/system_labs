/**
 * @file simulation-session.ts
 *
 * @description Composes the simulation's setup concerns with its execution
 * pipeline. The session prepares a still-created simulation (generating its
 * load and scheduling configured failures and autoscaling evaluations) before
 * handing execution to the engine. Keeping preparation here — rather than on
 * the engine — preserves the engine's single responsibility of coordinating
 * execution and leaves traffic generation a separate concern that an outer
 * orchestration layer composes alongside the engine.
 */

import { SimulationRuntime } from "./simulation-runtime.js";
import { SimulationEngine } from "./simulation-engine.js";
import { TrafficGenerator } from "../initializers/traffic-generator.js";
import { FailureScheduler } from "../initializers/failure-scheduler.js";
import { AutoscalingScheduler } from "../autoscaling/autoscaling-scheduler.js";

/**
 * Coordinates the setup that precedes a simulation run: traffic generation,
 * failure scheduling, and autoscaling initialization. It only populates the
 * runtime's requests and event queue while the simulation is still `created`;
 * it never advances the clock or changes the status. Execution itself is
 * delegated to the {@link SimulationEngine}.
 */
export class SimulationSession {
  constructor(
    private readonly runtime: SimulationRuntime,
    private readonly engine: SimulationEngine,
    private readonly trafficGenerator: TrafficGenerator,
    private readonly failureScheduler: FailureScheduler,
    private readonly autoscalingScheduler: AutoscalingScheduler,
  ) {}

  /**
   * Prepares a created simulation for execution: generates its initial load
   * from the given source node, queues configured failures, and schedules the
   * first autoscaling evaluations.
   *
   * @param entryNodeId - The component each generated request originates from.
   * @throws If the simulation is not currently `created`.
   */
  prepare(entryNodeId: string): void {
    if (this.runtime.simulation.status !== "created") {
      throw new Error(
        `Simulation cannot be prepared from status ${this.runtime.simulation.status}`,
      );
    }

    this.trafficGenerator.generate(entryNodeId);
    this.failureScheduler.schedule();
    this.autoscalingScheduler.schedule();
  }

  /**
   * Prepares and then executes the simulation to completion.
   *
   * @param entryNodeId - The component each generated request originates from.
   * @throws If the simulation cannot be prepared from its current status.
   */
  run(entryNodeId: string): void {
    this.prepare(entryNodeId);
    this.engine.run();
  }
}
