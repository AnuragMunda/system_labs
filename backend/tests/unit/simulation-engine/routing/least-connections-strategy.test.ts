import { describe, expect, it } from "vitest";
import { LeastConnectionsStrategy } from "@/simulation-engine/routing/least-connections-strategy.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import { SimulationRandom } from "@/simulation-engine/random/simulation-random.js";
import { RoutingContext } from "@/simulation-engine/routing/routing-context.js";

describe("LeastConnectionsStrategy", () => {
  const edges: ArchitectureEdge[] = [
    {
      id: "edge-1",
      source: "gateway",
      target: "api-a",
      config: {},
    },
    {
      id: "edge-2",
      source: "gateway",
      target: "api-b",
      config: {},
    },
    {
      id: "edge-3",
      source: "gateway",
      target: "api-c",
      config: {},
    },
  ];

  function makeContext(activeRequests: Record<string, number>): RoutingContext {
    return {
      sourceNodeId: "gateway",
      requestId: "request-1",
      random: new SimulationRandom(42),
      getActiveRequestCount: (nodeId: string) => activeRequests[nodeId] ?? 0,
    };
  }

  it("selects the target with the fewest active requests", () => {
    const strategy = new LeastConnectionsStrategy();

    // A has 5, B has 2, C has 7 → B is the least busy.
    const selected = strategy.selectEdge(
      edges,
      makeContext({ "api-a": 5, "api-b": 2, "api-c": 7 }),
    );

    expect(selected.target).toBe("api-b");
  });

  it("breaks ties toward the first edge", () => {
    const strategy = new LeastConnectionsStrategy();

    // A and B are tied at 2; the first encountered edge must win.
    const selected = strategy.selectEdge(
      edges,
      makeContext({ "api-a": 2, "api-b": 2, "api-c": 5 }),
    );

    expect(selected.target).toBe("api-a");
  });

  it("throws when no outgoing edges exist", () => {
    const strategy = new LeastConnectionsStrategy();

    expect(() => strategy.selectEdge([], makeContext({}))).toThrow(
      "No outgoing edges available for node gateway.",
    );
  });
});
