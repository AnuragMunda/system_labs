import { ArchitectureTopology } from "@/simulation-engine/topology/architecture-topology.js";
import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { describe, expect, it } from "vitest";

function createGraph(): ArchitectureGraph {
  return {
    nodes: [
      {
        id: "client",
        type: "client",
        name: "Client",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "api",
        type: "api",
        name: "API",
        position: { x: 100, y: 0 },
        config: {},
      },
      {
        id: "database",
        type: "database",
        name: "Database",
        position: { x: 200, y: 0 },
        config: {},
      },
    ],
    edges: [
      { id: "edge-1", source: "client", target: "api", config: {} },
      { id: "edge-2", source: "api", target: "database", config: {} },
    ],
  };
}

describe("ArchitectureTopology", () => {
  const topology = new ArchitectureTopology(createGraph());

  it("should return a node by id", () => {
    const node = topology.getNode("api");

    expect(node?.id).toBe("api");
    expect(node?.type).toBe("api");
  });

  it("should return undefined for a missing node", () => {
    expect(topology.getNode("missing")).toBeUndefined();
  });

  it("should return the edge connecting two nodes", () => {
    const edge = topology.getEdge("client", "api");

    expect(edge?.id).toBe("edge-1");
    expect(edge?.source).toBe("client");
    expect(edge?.target).toBe("api");
  });

  it("should return undefined when no edge connects the two nodes", () => {
    expect(topology.getEdge("client", "database")).toBeUndefined();
  });

  it("should return undefined when the nodes are reversed", () => {
    expect(topology.getEdge("api", "client")).toBeUndefined();
  });

  it("should return the outgoing edges of a node", () => {
    const edges = topology.getOutgoingEdges("api");

    expect(edges.map((edge) => edge.target)).toEqual(["database"]);
  });

  it("should return no outgoing edges for a terminal node", () => {
    expect(topology.getOutgoingEdges("database")).toEqual([]);
  });

  it("should return the next nodes reachable from a node", () => {
    expect(topology.getNextNodes("client").map((node) => node.id)).toEqual([
      "api",
    ]);
  });

  it("should return empty next nodes for a terminal node", () => {
    expect(topology.getNextNodes("database")).toEqual([]);
  });
});
