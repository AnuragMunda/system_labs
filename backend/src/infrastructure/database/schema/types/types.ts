/**
 * @file types.ts
 *
 * @description Shared shape types used to type JSONB columns on the database
 * tables (architecture graphs, simulation configs, and scenario events).
 */

import { ArchitectureNode } from "@/domain/architecture/component.types.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";

export type { SimulationConfig } from "@/domain/simulation/simulation.types.js";

/** JSONB shape of an architecture's graph: its nodes and edges. */
export interface ArchitectureGraph {
  // Nodes and edges of the architecture graph.
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

//------------- Scenario Events -------------//

/** Discriminated union of all scenario event shapes stored for an architecture. */
export type ScenarioEvent =
  | TrafficSpikeEvent
  | ServiceFailureEvent
  | ServiceRecoveryEvent
  | NetworkLatencyEvent
  | PacketLossEvent;

/** Common fields shared by every scenario event type. */
interface BaseScenarioEvent {
  id: string;

  /**
   * Time (in ms) after simulation start
   * when this event should execute.
   */
  timestampMs: number;
}

/** Surges the requests-per-second rate on the target architecture. */
export interface TrafficSpikeEvent extends BaseScenarioEvent {
  type: "traffic_spike";
  requestsPerSecond: number;
}

/** Marks a component as failed so requests are routed around/blocked by it. */
export interface ServiceFailureEvent extends BaseScenarioEvent {
  type: "service_failure";
  targetNodeId: string;
}

/** Restores a previously failed component. */
export interface ServiceRecoveryEvent extends BaseScenarioEvent {
  type: "service_recovery";
  targetNodeId: string;
}

/** Injects artificial latency on a connection. */
export interface NetworkLatencyEvent extends BaseScenarioEvent {
  type: "network_latency";
  targetEdgeId: string;
  latencyMs: number;
}

/** Simulates packet loss on a connection. */
export interface PacketLossEvent extends BaseScenarioEvent {
  type: "packet_loss";
  targetEdgeId: string;
  packetLossRate: number;
}
