/**
 * @file routing-strategy.ts
 *
 * @description The contract for choosing which of a node's outgoing edges a
 * request should travel across next. Implementations may hold per-source-node
 * state (for example round-robin counters) and must select deterministically.
 */

import type { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import type { RoutingContext } from "./routing-context.js";

export interface RoutingStrategy {
  selectEdge(
    edges: ArchitectureEdge[],
    context: RoutingContext,
  ): ArchitectureEdge;
}
