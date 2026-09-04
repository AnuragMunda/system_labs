/**
 * @file round-robin-strategy.ts
 *
 * @description A routing strategy that distributes requests across a node's
 * outgoing edges evenly, cycling through them in the order they are supplied.
 */

import type { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import type { RoutingContext } from "./routing-context.js";
import type { RoutingStrategy } from "./routing-strategy.js";

export class RoundRobinStrategy implements RoutingStrategy {
  // Tracks the next edge position per source node, so multiple sources keep
  // independent, non-interfering counters.
  private readonly positions = new Map<string, number>();

  selectEdge(
    edges: ArchitectureEdge[],
    context: RoutingContext,
  ): ArchitectureEdge {
    if (edges.length === 0) {
      throw new Error(
        `No outgoing edges available for node ${context.sourceNodeId}.`,
      );
    }

    const currentPosition = this.positions.get(context.sourceNodeId) ?? 0;

    const selectedEdge = edges[currentPosition];

    if (!selectedEdge) {
      throw new Error(
        `Unable to select routing edge for node ${context.sourceNodeId}.`,
      );
    }

    // Wrap around to the first edge after reaching the end of the list.
    const nextPosition = (currentPosition + 1) % edges.length;

    this.positions.set(context.sourceNodeId, nextPosition);

    return selectedEdge;
  }

  reset(): void {
    this.positions.clear();
  }
}
