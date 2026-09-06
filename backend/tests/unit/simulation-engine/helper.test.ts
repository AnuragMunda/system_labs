import { shouldFail } from "@/simulation-engine/helper.js";
import { describe, expect, it } from "vitest";

describe("shouldFail", () => {
  it("should return true when randomValue is below errorRate", () => {
    expect(shouldFail(0.5, 0.3)).toBe(true);
  });

  it("should return false when randomValue is above errorRate", () => {
    expect(shouldFail(0.3, 0.5)).toBe(false);
  });

  it("should return false when errorRate is 0", () => {
    expect(shouldFail(0, 0)).toBe(false);
  });

  it("should return true when errorRate is 1", () => {
    expect(shouldFail(1, 0.99)).toBe(true);
  });

  it("should throw for negative errorRate", () => {
    expect(() => shouldFail(-0.1, 0.5)).toThrow(
      "Error rate must be between 0 and 1. Received: -0.1.",
    );
  });

  it("should throw for errorRate greater than 1", () => {
    expect(() => shouldFail(1.1, 0.5)).toThrow(
      "Error rate must be between 0 and 1. Received: 1.1.",
    );
  });

  it("should throw for negative randomValue", () => {
    expect(() => shouldFail(0.5, -0.1)).toThrow(
      "Random value must be between 0 and 1. Received: -0.1.",
    );
  });

  it("should throw for randomValue greater than or equal to 1", () => {
    expect(() => shouldFail(0.5, 1.0)).toThrow(
      "Random value must be between 0 and 1. Received: 1.",
    );
  });
});
