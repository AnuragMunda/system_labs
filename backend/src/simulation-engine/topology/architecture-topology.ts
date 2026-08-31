import { ArchitectureGraph } from "@/domain/architecture/architecture.types.js";
import { ArchitectureNode } from "@/domain/architecture/component.types.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";

export class ArchitectureTopology {
  constructor(private readonly graph: ArchitectureGraph) {}

  getNode(nodeId: string): ArchitectureNode | undefined {
    return this.graph.nodes.find((node) => node.id === nodeId);
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
