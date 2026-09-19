import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_THRESHOLDS } from "@/simulation-engine/components/health/default-thresholds.js";

describe("DEFAULT_HEALTH_THRESHOLDS", () => {
  it.each(["utilization", "errorRate", "latencyMs"] as const)(
    "should keep the degraded threshold below the critical threshold for %s",
    (metric) => {
      const { degraded, critical } = DEFAULT_HEALTH_THRESHOLDS[metric];

      expect(degraded).toBeLessThan(critical);
    },
  );

  it("should provide the expected default bounds", () => {
    expect(DEFAULT_HEALTH_THRESHOLDS).toEqual({
      utilization: { degraded: 0.7, critical: 0.9 },
      errorRate: { degraded: 0.05, critical: 0.2 },
      latencyMs: { degraded: 200, critical: 500 },
    });
  });
});
