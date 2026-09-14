import { SimulationRandom } from "../random/simulation-random.js";

/**
 * @file routing-context.ts
 *
 * @description Inputs available to a routing strategy when it decides which
 * outgoing edge to use for a request.
 */
export interface RoutingContext {
  /** The node whose outgoing edges are being evaluated. */
  sourceNodeId: string;
  /** The id of the request being routed. */
  requestId: string;
  /** Returns the current number of in-flight requests for a target node. */
  getActiveRequestCount: (nodeId: string) => number;
  /** The simulation's deterministic PRNG instance. */
  random: SimulationRandom;
}
