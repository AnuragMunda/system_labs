import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import type { RoutingContext, RoutingStrategy } from "../utils/types.js";

/**
 * Routes to the downstream node with the lowest active request count at
 * decision time. Ties are broken toward the first edge.
 */
export class LeastConnectionsStrategy implements RoutingStrategy {
  /**
   * Iterates over `edges` and returns the one targeting the node with the
   * fewest active requests.
   */
  selectEdge(
    edges: ArchitectureEdge[],
    context: RoutingContext,
  ): ArchitectureEdge {
    if (edges.length === 0) {
      throw new Error(
        `No outgoing edges available for node ${context.sourceNodeId}.`,
      );
    }

    let selectedEdge = edges[0]!;
    let lowestActiveRequests = context.getActiveRequestCount(
      selectedEdge.target,
    );

    for (let index = 1; index < edges.length; index++) {
      const edge = edges[index];

      if (!edge) {
        continue;
      }

      const activeRequests = context.getActiveRequestCount(edge.target);

      if (activeRequests < lowestActiveRequests) {
        selectedEdge = edge;
        lowestActiveRequests = activeRequests;
      }
    }

    return selectedEdge;
  }
}
