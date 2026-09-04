import { describe, expect, it } from "vitest";
import { RoundRobinStrategy } from "@/simulation-engine/routing/round-robin-strategy.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";

describe("RoundRobinStrategy", () => {
  const edges: ArchitectureEdge[] = [
    {
      id: "edge-1",
      source: "gateway",
      target: "api-1",
      config: {},
    },
    {
      id: "edge-2",
      source: "gateway",
      target: "api-2",
      config: {},
    },
    {
      id: "edge-3",
      source: "gateway",
      target: "api-3",
      config: {},
    },
  ];

  const context = {
    sourceNodeId: "gateway",
    requestId: "request-1",
  };

  it("selects edges in round-robin order", () => {
    const strategy = new RoundRobinStrategy();

    expect(strategy.selectEdge(edges, context).id).toBe("edge-1");
    expect(strategy.selectEdge(edges, context).id).toBe("edge-2");
    expect(strategy.selectEdge(edges, context).id).toBe("edge-3");
    expect(strategy.selectEdge(edges, context).id).toBe("edge-1");
  });

  it("preserves the order of the supplied edges", () => {
    const strategy = new RoundRobinStrategy();

    // Supplied in reverse id order; the strategy must follow the exact array
    // order given rather than sorting or reordering the edges.
    const shuffled: ArchitectureEdge[] = [
      { id: "edge-3", source: "gateway", target: "api-3", config: {} },
      { id: "edge-1", source: "gateway", target: "api-1", config: {} },
      { id: "edge-2", source: "gateway", target: "api-2", config: {} },
    ];

    expect(strategy.selectEdge(shuffled, context).id).toBe("edge-3");
    expect(strategy.selectEdge(shuffled, context).id).toBe("edge-1");
    expect(strategy.selectEdge(shuffled, context).id).toBe("edge-2");
    expect(strategy.selectEdge(shuffled, context).id).toBe("edge-3");
  });

  it("maintains independent positions for different source nodes", () => {
    const strategy = new RoundRobinStrategy();

    const anotherContext = {
      sourceNodeId: "another-gateway",
      requestId: "request-2",
    };

    expect(strategy.selectEdge(edges, context).id).toBe("edge-1");
    expect(strategy.selectEdge(edges, context).id).toBe("edge-2");

    expect(strategy.selectEdge(edges, anotherContext).id).toBe("edge-1");
    expect(strategy.selectEdge(edges, anotherContext).id).toBe("edge-2");
  });

  it("throws when no outgoing edges exist", () => {
    const strategy = new RoundRobinStrategy();

    expect(() => strategy.selectEdge([], context)).toThrow(
      "No outgoing edges available for node gateway.",
    );
  });

  it("can reset routing state", () => {
    const strategy = new RoundRobinStrategy();

    expect(strategy.selectEdge(edges, context).id).toBe("edge-1");
    expect(strategy.selectEdge(edges, context).id).toBe("edge-2");

    strategy.reset();

    expect(strategy.selectEdge(edges, context).id).toBe("edge-1");
  });
});
