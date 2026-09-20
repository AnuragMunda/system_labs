import { describe, expect, it } from "vitest";
import { AutoscalingController } from "@/simulation-engine/autoscaling/autoscaling-controller.js";
import { SimulationRuntime } from "@/simulation-engine/core/simulation-runtime.js";
import type { AutoscalingConfig } from "@/domain/architecture/component.types.js";
import type { ArchitectureNode } from "@/domain/architecture/component.types.js";
import type { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import type { Simulation } from "@/domain/simulation/simulation.types.js";
import type { SimulationEvent } from "@/domain/simulation/event.types.js";

function node(
  id: string,
  type: ArchitectureNode["type"],
  config: ArchitectureNode["config"] = {},
): ArchitectureNode {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    config,
  };
}

function autoscaling(
  overrides: Partial<AutoscalingConfig> = {},
): AutoscalingConfig {
  return {
    enabled: true,
    min: 1,
    max: 10,
    targetCpu: 50,
    ...overrides,
  };
}

function createSimulation(graph: ArchitectureGraph, seed = 42): Simulation {
  return {
    id: "simulation-1",
    architectureId: "architecture-1",
    status: "created",
    config: {
      durationMs: 10000,
      requestsPerSecond: 10,
      simulationSpeed: 1,
      collectMetrics: true,
      emitEvents: true,
    },
    currentTimeMs: 0,
    seed,
    architectureSnapshot: graph,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function evaluateEvent(nodeId: string, timestampMs = 250): SimulationEvent {
  return {
    id: `event-autoscale-eval-${nodeId}-${timestampMs}`,
    simulationId: "simulation-1",
    timestampMs,
    type: "autoscaling.evaluate",
    sourceNodeId: nodeId,
  };
}

function drainEvents(runtime: SimulationRuntime): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  while (!runtime.eventQueue.isEmpty()) {
    const event = runtime.eventQueue.dequeue();
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function scaledEventOf(events: SimulationEvent[]): SimulationEvent | undefined {
  return events.find((event) => event.type === "component.scaled");
}

function setActiveRequests(
  runtime: SimulationRuntime,
  nodeId: string,
  count: number,
): void {
  runtime.updateComponent(nodeId, { activeRequests: count });
}

function createAutoscalingRuntime(nodes: ArchitectureNode[]): {
  runtime: SimulationRuntime;
  controller: AutoscalingController;
} {
  const runtime = new SimulationRuntime(createSimulation({ nodes, edges: [] }));

  return { runtime, controller: new AutoscalingController(runtime) };
}

describe("AutoscalingController", () => {
  describe("autoscaling configuration", () => {
    it("should never change the replica count of a component with autoscaling disabled", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ enabled: false }),
        }),
      ]);

      setActiveRequests(runtime, "api", 10);
      controller.evaluate(evaluateEvent("api"));

      expect(runtime.getComponent("api").replicas).toBe(2);
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });

    it("should start an enabled component at its configured replica count", () => {
      const { runtime } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 3,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      expect(runtime.getComponent("api").replicas).toBe(3);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(15);
    });

    it("should respect the configured minimum replica count", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 2, max: 10 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 0);
      controller.evaluate(evaluateEvent("api"));

      expect(runtime.getComponent("api").replicas).toBe(2);
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });

    it("should never scale above the configured maximum replica count", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 10,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 10 }),
        }),
      ]);

      // 31 active on effectiveConcurrency 50 → 62% (> 60% upper band). The
      // +1 step would be clamped to max, so no decision is scheduled.
      setActiveRequests(runtime, "api", 31);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(10);
    });

    it("should leave replicas unchanged when evaluating a component already at max", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 4,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 4 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 10);
      controller.evaluate(evaluateEvent("api"));

      expect(runtime.getComponent("api").replicas).toBe(4);
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });

    it("should leave replicas unchanged when evaluating a component already at min", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 1,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 4 }),
        }),
      ]);

      controller.evaluate(evaluateEvent("api"));

      expect(runtime.getComponent("api").replicas).toBe(1);
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });
  });

  describe("utilization evaluation", () => {
    it("should scale down when utilization is below the target band", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      // 2 / 10 active requests => 20% utilization (< 40% lower band).
      setActiveRequests(runtime, "api", 2);
      controller.evaluate(evaluateEvent("api"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(1);
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should scale up when utilization is above the target band", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      // 7 / 10 active requests => 70% utilization (> 60% upper band).
      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(3);
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should not scale when utilization is exactly at the target", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      // 5 / 10 active requests => 50% utilization, inside the deadband.
      setActiveRequests(runtime, "api", 5);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should not scale when utilization sits inside the target deadband", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      // 4 / 10 active requests => 40% utilization, still inside the deadband
      // (strictly below 40% triggers a scale-down).
      setActiveRequests(runtime, "api", 4);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should ignore processed request volume when utilization is inside the band", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 1,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 5 }),
        }),
      ]);

      // Throughput alone never triggers scaling: utilization uses only
      // activeRequests (0 here), and the component already sits at min.
      for (let i = 0; i < 1000; i++) {
        runtime.recordProcessedRequest("api");
      }

      controller.evaluate(evaluateEvent("api"));

      expect(runtime.getComponent("api").processedRequests).toBe(1000);
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(1);
    });
  });

  describe("scale-up behavior", () => {
    it("should increase replicas by one when above the scaling threshold", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 5 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(3);
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should schedule the decision without mutating effective concurrency", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 5 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(3);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(10);
      expect(runtime.getEffectiveConcurrency("api")).toBe(10);

      // Eval alone adds capacity only once the decision is applied; the
      // processor does this via setComponentReplicas.
      runtime.setComponentReplicas("api", 3);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(15);
      expect(runtime.getEffectiveConcurrency("api")).toBe(15);
    });

    it("should grow capacity only when the scaled decision is applied", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 5 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 10);
      expect(runtime.hasCapacity("api")).toBe(false);

      controller.evaluate(evaluateEvent("api"));
      expect(runtime.getComponent("api").replicas).toBe(2);
      expect(runtime.hasCapacity("api")).toBe(false);

      runtime.setComponentReplicas("api", 3);
      expect(runtime.hasCapacity("api")).toBe(true);
    });

    it("should scale up step by step only while utilization exceeds the band", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 2, max: 4 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 10);

      // Re-applying the just-scheduled step simulates the event processor
      // applying each component.scaled before the next evaluation.
      controller.evaluate(evaluateEvent("api", 100));
      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(3);
      runtime.setComponentReplicas("api", 3);

      controller.evaluate(evaluateEvent("api", 200));
      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(4);
      runtime.setComponentReplicas("api", 4);

      controller.evaluate(evaluateEvent("api", 300));
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });
  });

  describe("scale-down behavior", () => {
    it("should decrease replicas by one when utilization drops below the target band", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 5 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 0);
      controller.evaluate(evaluateEvent("api"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(1);
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should shrink capacity only when the scaled decision is applied", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 5 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 0);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(1);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(10);

      runtime.setComponentReplicas("api", 1);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(5);
      expect(runtime.getEffectiveConcurrency("api")).toBe(5);
    });

    it("should never scale below the configured minimum", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 2, max: 5 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 0);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should defer scale-down when it would drop capacity below active requests", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 3, targetCpu: 100 }),
        }),
      ]);

      // 8 / 10 active requests => 80% utilization (< 90% lower band for a
      // target of 100). Scaling 2 → 1 would leave capacity for only 5 requests
      // (< 8 active), so the decision must be deferred.
      setActiveRequests(runtime, "api", 8);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(2);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(10);
      expect(runtime.getComponent("api").activeRequests).toBe(8);
    });

    it("should scale down once enough capacity is free after a deferral", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 3, targetCpu: 100 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 8);
      controller.evaluate(evaluateEvent("api", 100));
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();

      // Once active requests drop to 4, scaling 2 → 1 (capacity 5) is safe.
      setActiveRequests(runtime, "api", 4);
      controller.evaluate(evaluateEvent("api", 200));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(1);
      expect(runtime.getComponent("api").replicas).toBe(2);
    });
  });

  describe("autoscaling events", () => {
    it("should emit component.scaled with previous and new replica counts", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.type).toBe("component.scaled");
      expect(event?.sourceNodeId).toBe("api");
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(3);
    });

    it("should place the scaled event at the evaluation timestamp", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api", 2750));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.timestampMs).toBe(2750);
    });

    it("should include the evaluated metric and target in the scaled payload", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.utilization).toBe(70);
      expect(event?.payload?.targetCpu).toBe(50);
      expect(event?.payload?.reason).toBe("cpu_target");
    });

    it("should not emit component.scaled when replicas do not change", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api", 5);
      controller.evaluate(evaluateEvent("api"));

      expect(drainEvents(runtime)).toEqual([]);
    });

    it("should never emit an autoscaling.evaluated event", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      for (const event of drainEvents(runtime)) {
        expect(event.type).not.toBe("autoscaling.evaluated");
      }
    });
  });

  describe("runtime state consistency", () => {
    it("should preserve all unrelated runtime state when scaling", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api", 7);
      runtime.updateComponent("api", {
        processedRequests: 5,
        totalProcessingAttempts: 6,
        failedProcessingAttempts: 2,
        totalProcessingLatencyMs: 30,
        lastProcessingLatencyMs: 20,
        recoveryGeneration: 2,
      });
      runtime.setComponentHealth("api", "degraded");
      runtime.enqueueRequest("api", "queued-1");
      runtime.enqueueRequest("api", "queued-2");

      const before = runtime.getComponent("api");

      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(3);
      const after = runtime.getComponent("api");
      expect(after.replicas).toBe(before.replicas);
      expect(after.effectiveConcurrency).toBe(before.effectiveConcurrency);
      expect(after.activeRequests).toBe(before.activeRequests);
      expect(after.processedRequests).toBe(before.processedRequests);
      expect(after.totalProcessingAttempts).toBe(
        before.totalProcessingAttempts,
      );
      expect(after.failedProcessingAttempts).toBe(
        before.failedProcessingAttempts,
      );
      expect(after.totalProcessingLatencyMs).toBe(
        before.totalProcessingLatencyMs,
      );
      expect(after.lastProcessingLatencyMs).toBe(
        before.lastProcessingLatencyMs,
      );
      expect(after.health).toBe("degraded");
      expect(after.recoveryGeneration).toBe(before.recoveryGeneration);
      expect(runtime.getQueuedRequestCount("api")).toBe(2);
    });
  });

  describe("failed components", () => {
    it("should not scale a failed component", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      runtime.setComponentHealth("api", "failed");
      setActiveRequests(runtime, "api", 10);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
      expect(runtime.getComponent("api").replicas).toBe(2);
    });

    it("should not accidentally change the health of a failed component", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      runtime.setComponentHealth("api", "failed");
      controller.evaluate(evaluateEvent("api"));

      expect(runtime.getComponent("api").health).toBe("failed");
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });

    it("should resume evaluating again after the component recovers", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      runtime.setComponentHealth("api", "failed");
      controller.evaluate(evaluateEvent("api", 100));
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();

      runtime.setComponentHealth("api", "healthy");
      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api", 200));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(3);
    });

    it("should preserve the replica count across a failure and recovery", () => {
      const { runtime } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 4,
          concurrency: 5,
          autoscaling: autoscaling({ min: 2, max: 6 }),
        }),
      ]);

      runtime.setComponentHealth("api", "failed");
      runtime.setComponentHealth("api", "healthy");

      expect(runtime.getComponent("api").replicas).toBe(4);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(20);
    });
  });

  describe("recovery generation interaction", () => {
    it("should not invalidate the recovery generation when evaluating", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      const generation = runtime.startRecoveryCycle("api");
      setActiveRequests(runtime, "api", 7);
      controller.evaluate(evaluateEvent("api"));

      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(3);
      expect(runtime.getComponent("api").replicas).toBe(2);
      expect(runtime.getRecoveryGeneration("api")).toBe(generation);
    });

    it("should retain an applied replica count across a recovery cycle", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api", "api", {
          replicas: 3,
          concurrency: 2,
          autoscaling: autoscaling({ min: 1, max: 6 }),
        }),
      ]);

      setActiveRequests(runtime, "api", 4);
      controller.evaluate(evaluateEvent("api", 100));
      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(4);
      runtime.setComponentReplicas("api", 4);

      runtime.setComponentHealth("api", "failed");
      runtime.setComponentHealth("api", "healthy");

      expect(runtime.getComponent("api").replicas).toBe(4);
      expect(runtime.getComponent("api").effectiveConcurrency).toBe(8);
    });
  });

  describe("multiple components", () => {
    it("should evaluate each component against its own replica count", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api-a", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
        node("api-b", "api", {
          replicas: 3,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api-a", 7);
      controller.evaluate(evaluateEvent("api-a"));

      const event = scaledEventOf(drainEvents(runtime));
      expect(event?.sourceNodeId).toBe("api-a");
      expect(event?.payload?.previousReplicas).toBe(2);
      expect(event?.payload?.replicas).toBe(3);
      expect(runtime.getComponent("api-b").replicas).toBe(3);
      expect(runtime.getComponent("api-b").effectiveConcurrency).toBe(15);
    });

    it("should keep two independently autoscaled components independent", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api-a", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
        node("api-b", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling(),
        }),
      ]);

      setActiveRequests(runtime, "api-a", 7);
      setActiveRequests(runtime, "api-b", 0);

      controller.evaluate(evaluateEvent("api-a"));
      const first = scaledEventOf(drainEvents(runtime));
      expect(first?.sourceNodeId).toBe("api-a");
      expect(first?.payload?.replicas).toBe(3);

      controller.evaluate(evaluateEvent("api-b"));
      const second = scaledEventOf(drainEvents(runtime));
      expect(second?.sourceNodeId).toBe("api-b");
      expect(second?.payload?.replicas).toBe(1);
    });

    it("should use each component's own autoscaling configuration and metrics", () => {
      const { runtime, controller } = createAutoscalingRuntime([
        node("api-a", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 10, targetCpu: 50 }),
        }),
        node("api-b", "api", {
          replicas: 2,
          concurrency: 5,
          autoscaling: autoscaling({ min: 1, max: 3, targetCpu: 90 }),
        }),
      ]);

      // api-a: 7/10 => 70% (> 60% upper band) => scale up. api-b carries the
      // same load but its deadband is [80, 100] (targetCpu 90), so 70% stays
      // inside it and triggers nothing.
      setActiveRequests(runtime, "api-a", 7);
      setActiveRequests(runtime, "api-b", 7);

      controller.evaluate(evaluateEvent("api-a"));
      expect(scaledEventOf(drainEvents(runtime))?.payload?.replicas).toBe(3);

      controller.evaluate(evaluateEvent("api-b"));
      expect(scaledEventOf(drainEvents(runtime))).toBeUndefined();
    });
  });

  describe("determinism", () => {
    it("should make identical decisions for identical simulation state", () => {
      function run(): Pick<
        SimulationEvent,
        "timestampMs" | "sourceNodeId" | "payload"
      >[] {
        const { runtime, controller } = createAutoscalingRuntime([
          node("api", "api", {
            replicas: 2,
            concurrency: 5,
            autoscaling: autoscaling({ min: 1, max: 5 }),
          }),
        ]);

        setActiveRequests(runtime, "api", 7);
        controller.evaluate(evaluateEvent("api", 100));
        controller.evaluate(evaluateEvent("api", 200));

        // Event ids are randomUUIDs, so compare only the decision fields.
        return drainEvents(runtime)
          .filter((event) => event.type === "component.scaled")
          .map((event) => ({
            timestampMs: event.timestampMs,
            sourceNodeId: event.sourceNodeId,
            payload: event.payload,
          }));
      }

      expect(run()).toEqual(run());
    });
  });
});
