/**
 * @file connection.types.ts
 *
 * @description This file defines the types and interfaces related to architecture connections in the system.
 */

/**
 * A directed connection between two nodes in an architecture graph,
 * carrying the tunable network configuration used during simulation.
 */
export interface ArchitectureEdge {
  id: string;

  source: string;
  target: string;

  config: ConnectionConfig;
}

/** Network behavior tuning for a connection. All fields are optional. */
interface ConnectionConfig {
  latencyMs?: number; // Average latency in milliseconds
  bandwidthMbps?: number; // Maximum bandwidth in megabits per second
  packetLossRate?: number; // Rate of packet loss occurring

  // Extended editor configuration
  protocol?: string; // e.g. "http", "grpc", "tcp", "kafka"
}
