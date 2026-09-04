/**
 * @file network-latency.ts
 *
 * @description Resolves the network latency of a single architecture
 * connection (edge). The value is read from the edge's configuration and
 * validated before being applied during event routing.
 */

import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";

// Applied when a connection has no latency configured.
const DEFAULT_NETWORK_LATENCY_MS = 10;

export function getNetworkLatency(edge: ArchitectureEdge): number {
  const latencyMs = edge.config.latencyMs;

  // Default latency is used for connections without an explicit value.
  if (latencyMs === undefined) {
    return DEFAULT_NETWORK_LATENCY_MS;
  }

  // A negative latency would move a request backwards in time.
  if (latencyMs < 0) {
    throw new Error(
      `Connection ${edge.id} has an invalid latency: ${latencyMs}ms.`,
    );
  }

  return latencyMs;
}
