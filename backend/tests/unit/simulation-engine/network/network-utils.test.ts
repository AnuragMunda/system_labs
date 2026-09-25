import { getTransmissionTimeMs } from "@/simulation-engine/utils/helpers.js";
import { describe, expect, it } from "vitest";

describe("getTransmissionTimeMs", () => {
  it("should compute the transmission time for a payload and bandwidth", () => {
    // (1,000,000 bytes * 8 bits) / (10 Mbps * 1,000,000) = 0.8s = 800ms.
    expect(getTransmissionTimeMs(1_000_000, 10)).toBe(800);
  });

  it("should scale transmission time with the payload size", () => {
    const halfSize = getTransmissionTimeMs(500_000, 10);
    const fullSize = getTransmissionTimeMs(1_000_000, 10);

    expect(halfSize).toBe(fullSize / 2);
  });

  it("should scale transmission time inversely with bandwidth", () => {
    const slow = getTransmissionTimeMs(1_000_000, 10);
    const fast = getTransmissionTimeMs(1_000_000, 20);

    expect(fast).toBeCloseTo(slow / 2, 5);
  });

  it("should allow an empty payload to transmit instantly", () => {
    expect(getTransmissionTimeMs(0, 50)).toBe(0);
  });

  it("should throw when the size is negative", () => {
    expect(() => getTransmissionTimeMs(-1, 10)).toThrowError(
      "Request size must be a non-negative integer of bytes. Received: -1.",
    );
  });

  it("should throw when the size is not an integer", () => {
    expect(() => getTransmissionTimeMs(100.5, 10)).toThrowError(
      "Request size must be a non-negative integer of bytes. Received: 100.5.",
    );
  });

  it("should throw when the bandwidth is zero", () => {
    expect(() => getTransmissionTimeMs(100, 0)).toThrowError(
      "Bandwidth must be a positive number of Mbps. Received: 0.",
    );
  });

  it("should throw when the bandwidth is negative", () => {
    expect(() => getTransmissionTimeMs(100, -5)).toThrowError(
      "Bandwidth must be a positive number of Mbps. Received: -5.",
    );
  });
});
