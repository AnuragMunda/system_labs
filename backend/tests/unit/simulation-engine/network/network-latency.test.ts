import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import { getNetworkLatency } from "@/simulation-engine/network/network-latency.js";
import { describe, expect, it } from "vitest";

function createEdge(
  config: ArchitectureEdge["config"],
  id = "edge-1",
): ArchitectureEdge {
  return { id, source: "client", target: "api", config };
}

describe("getNetworkLatency", () => {
  it("should return the configured edge latency", () => {
    expect(getNetworkLatency(createEdge({ latencyMs: 30 }))).toBe(30);
  });

  it("should return the default latency when the edge has no latency configured", () => {
    expect(getNetworkLatency(createEdge({}))).toBe(10);
  });

  it("should return an explicit latency of zero", () => {
    expect(getNetworkLatency(createEdge({ latencyMs: 0 }))).toBe(0);
  });

  it("should throw when the edge latency is negative", () => {
    expect(() => getNetworkLatency(createEdge({ latencyMs: -5 }))).toThrowError(
      "Connection edge-1 has an invalid latency: -5ms.",
    );
  });
});
