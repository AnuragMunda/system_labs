import {
  canRetry,
  getEffectiveConcurrency,
  shouldFail,
} from "@/simulation-engine/helper.js";
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

describe("getEffectiveConcurrency", () => {
  it("calculates effective concurrency", () => {
    expect(getEffectiveConcurrency(3, 10)).toBe(30);
  });

  it("works with a single replica", () => {
    expect(getEffectiveConcurrency(1, 10)).toBe(10);
  });

  it("works with a single concurrency slot", () => {
    expect(getEffectiveConcurrency(5, 1)).toBe(5);
  });

  it("rejects zero replicas", () => {
    expect(() => getEffectiveConcurrency(0, 10)).toThrow(
      "Replicas must be a positive integer.",
    );
  });

  it("rejects negative replicas", () => {
    expect(() => getEffectiveConcurrency(-1, 10)).toThrow(
      "Replicas must be a positive integer.",
    );
  });

  it("rejects non-integer replicas", () => {
    expect(() => getEffectiveConcurrency(1.5, 10)).toThrow(
      "Replicas must be a positive integer.",
    );
  });

  it("rejects zero concurrency", () => {
    expect(() => getEffectiveConcurrency(3, 0)).toThrow(
      "Concurrency must be a positive integer.",
    );
  });

  it("rejects negative concurrency", () => {
    expect(() => getEffectiveConcurrency(3, -1)).toThrow(
      "Concurrency must be a positive integer.",
    );
  });

  it("rejects non-integer concurrency", () => {
    expect(() => getEffectiveConcurrency(3, 2.5)).toThrow(
      "Concurrency must be a positive integer.",
    );
  });
});

describe("canRetry", () => {
  it("should return false when no retries are configured", () => {
    expect(canRetry(1, 0)).toBe(false);
  });

  it("should return true when current attempt is within retry budget", () => {
    expect(canRetry(1, 1)).toBe(true);
  });

  it("should return false when attempts exhaust the retry budget", () => {
    expect(canRetry(2, 1)).toBe(false);
  });

  it("should return true when attempts are within a larger retry budget", () => {
    expect(canRetry(2, 2)).toBe(true);
  });

  it("should return false when attempts exceed a larger retry budget", () => {
    expect(canRetry(3, 2)).toBe(false);
  });

  it("should reject attempts less than 1", () => {
    expect(() => canRetry(0, 2)).toThrow("Attempts must be at least 1.");
  });

  it("should reject negative maxRetries", () => {
    expect(() => canRetry(1, -1)).toThrow("Max retries cannot be negative.");
  });
});
