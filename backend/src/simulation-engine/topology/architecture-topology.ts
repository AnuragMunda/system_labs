/**
 * @file architecture-topology.ts
 *
 * @description Provides read-only accessors over an architecture graph,
 * exposing nodes and directed connections so routing and component behavior
 * can be resolved deterministically during simulation.
 */

import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { ArchitectureNode } from "@/domain/architecture/component.types.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";

export class ArchitectureTopology {
  constructor(private readonly graph: ArchitectureGraph) {}

  getNode(nodeId: string): ArchitectureNode | undefined {
    return this.graph.nodes.find((node) => node.id === nodeId);
  }

  /**
   * Returns the directed connection between two nodes, or undefined when no
   * such edge exists in the graph.
   */
  getEdge(
    sourceNodeId: string,
    targetNodeId: string,
  ): ArchitectureEdge | undefined {
    return this.graph.edges.find(
      (edge) => edge.source === sourceNodeId && edge.target === targetNodeId,
    );
  }

  getOutgoingEdges(nodeId: string): ArchitectureEdge[] {
    return this.graph.edges.filter((edge) => edge.source === nodeId);
  }

  getNextNodes(nodeId: string): ArchitectureNode[] {
    const outgoingEdges = this.getOutgoingEdges(nodeId);
    const nextNodes = outgoingEdges
      .map((edge) => this.getNode(edge.target))
      .filter((node): node is ArchitectureNode => node !== undefined);

    return nextNodes;
  }
}
