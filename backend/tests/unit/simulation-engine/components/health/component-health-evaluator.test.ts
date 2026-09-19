import { describe, expect, it } from "vitest";
import { ComponentHealthEvaluator } from "@/simulation-engine/components/health/component-health-evaluator.js";
import { DEFAULT_HEALTH_THRESHOLDS } from "@/simulation-engine/components/health/default-thresholds.js";
import { ComponentRuntimeState } from "@/simulation-engine/components/component-runtime-state.js";

function createState(
  overrides: Partial<ComponentRuntimeState> = {},
): ComponentRuntimeState {
  return {
    nodeId: "api",
    health: "healthy",
    activeRequests: 0,
    processedRequests: 0,
    totalProcessingAttempts: 0,
    failedProcessingAttempts: 0,
    totalProcessingLatencyMs: 0,
    effectiveConcurrency: 1,
    ...overrides,
  };
}

describe("ComponentHealthEvaluator", () => {
  describe("calculateMetrics", () => {
    it("should compute utilization as active requests over effective concurrency", () => {
      const evaluator = new ComponentHealthEvaluator();

      const metrics = evaluator.calculateMetrics(
        createState({ activeRequests: 3, effectiveConcurrency: 10 }),
      );

      expect(metrics.utilization).toBe(0.3);
    });

    it("should report full utilization when effective concurrency is zero", () => {
      const evaluator = new ComponentHealthEvaluator();

      const metrics = evaluator.calculateMetrics(
        createState({ activeRequests: 0, effectiveConcurrency: 0 }),
      );

      expect(metrics.utilization).toBe(1);
    });

    it("should compute error rate as failed over total attempts", () => {
      const evaluator = new ComponentHealthEvaluator();

      const metrics = evaluator.calculateMetrics(
        createState({
          totalProcessingAttempts: 10,
          failedProcessingAttempts: 2,
        }),
      );

      expect(metrics.errorRate).toBe(0.2);
    });

    it("should report zero error rate when no attempts exist", () => {
      const evaluator = new ComponentHealthEvaluator();

      const metrics = evaluator.calculateMetrics(createState());

      expect(metrics.errorRate).toBe(0);
    });

    it("should compute average latency as total over processed requests", () => {
      const evaluator = new ComponentHealthEvaluator();

      const metrics = evaluator.calculateMetrics(
        createState({ processedRequests: 4, totalProcessingLatencyMs: 800 }),
      );

      expect(metrics.averageLatencyMs).toBe(200);
    });

    it("should report zero average latency when nothing has been processed", () => {
      const evaluator = new ComponentHealthEvaluator();

      const metrics = evaluator.calculateMetrics(createState());

      expect(metrics.averageLatencyMs).toBe(0);
    });
  });

  describe("evaluate", () => {
    const evaluator = new ComponentHealthEvaluator();

    it("should be healthy when every metric is below its degraded threshold", () => {
      const health = evaluator.evaluate(
        createState({ activeRequests: 1, effectiveConcurrency: 10 }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("healthy");
    });

    it("should degrade when utilization reaches the degraded threshold", () => {
      const health = evaluator.evaluate(
        createState({ activeRequests: 7, effectiveConcurrency: 10 }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("degraded");
    });

    it("should be critical when utilization reaches the critical threshold", () => {
      const health = evaluator.evaluate(
        createState({ activeRequests: 9, effectiveConcurrency: 10 }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("critical");
    });

    it("should degrade when the error rate reaches the degraded threshold", () => {
      const health = evaluator.evaluate(
        createState({
          totalProcessingAttempts: 100,
          failedProcessingAttempts: 5,
        }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("degraded");
    });

    it("should be critical when the error rate reaches the critical threshold", () => {
      const health = evaluator.evaluate(
        createState({
          totalProcessingAttempts: 100,
          failedProcessingAttempts: 20,
        }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("critical");
    });

    it("should degrade when the average latency reaches the degraded threshold", () => {
      const health = evaluator.evaluate(
        createState({
          processedRequests: 2,
          totalProcessingLatencyMs: 400,
        }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("degraded");
    });

    it("should be critical when the average latency reaches the critical threshold", () => {
      const health = evaluator.evaluate(
        createState({
          processedRequests: 2,
          totalProcessingLatencyMs: 1000,
        }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("critical");
    });

    it("should reflect the worst severity across metrics", () => {
      // Utilization is degraded, latency is critical → critical wins.
      const health = evaluator.evaluate(
        createState({
          activeRequests: 7,
          effectiveConcurrency: 10,
          processedRequests: 3,
          totalProcessingLatencyMs: 1800,
        }),
        DEFAULT_HEALTH_THRESHOLDS,
      );

      expect(health).toBe("critical");
    });

    it("should treat boundary values as reaching the higher severity", () => {
      // exactly at degraded → degraded; exactly at critical → critical.
      expect(
        evaluator.evaluate(
          createState({ activeRequests: 7, effectiveConcurrency: 10 }),
          DEFAULT_HEALTH_THRESHOLDS,
        ),
      ).toBe("degraded");
      expect(
        evaluator.evaluate(
          createState({ activeRequests: 9, effectiveConcurrency: 10 }),
          DEFAULT_HEALTH_THRESHOLDS,
        ),
      ).toBe("critical");
    });
  });
});
