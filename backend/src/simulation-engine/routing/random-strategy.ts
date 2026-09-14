import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import type { RoutingContext } from "./routing-context.js";
import type { RoutingStrategy } from "./routing-strategy.js";

/**
 * Selects one of the available outgoing edges uniformly at random using the
 * simulation's deterministic PRNG.
 */
export class RandomStrategy implements RoutingStrategy {
  /**
   * Returns a randomly chosen edge from `edges`, using the deterministic RNG
   * in `context`.
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

    const index = Math.floor(context.random.next() * edges.length);
    const selectedEdge = edges[index];

    if (!selectedEdge) {
      throw new Error(
        `Unable to select routing edge for node ${context.sourceNodeId}.`,
      );
    }

    return selectedEdge;
  }
}
