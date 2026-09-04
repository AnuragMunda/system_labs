/**
 * @file routing-context.ts
 *
 * @description Inputs available to a routing strategy when it decides which
 * outgoing edge to use for a request.
 */
export interface RoutingContext {
  sourceNodeId: string;
  requestId: string;
}
