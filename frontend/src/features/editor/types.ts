// Editor domain types. These are the *client* models used by React Flow and the
// inspector. They serialize to / from the backend `ArchitectureNode` /
// `ArchitectureEdge` shapes (see lib/api/architectures.ts). The React Flow node
// `type` is always "component" (the renderer key); the backend `type` is carried
// inside `data.kind` so serialization is unambiguous.
import type { Edge, Node } from "@xyflow/react";
import type { Health } from "@/lib/health";

/** Palette grouping shown in the left component palette. */
export type ComponentCategory =
  | "infrastructure"
  | "compute"
  | "data"
  | "messaging"
  | "external";

/** Canonical component kinds — mirrors the backend `componentType` union. */
export type ComponentKind =
  | "client"
  | "load_balancer"
  | "api_gateway"
  | "cdn"
  | "reverse_proxy"
  | "api"
  | "cache"
  | "database"
  | "queue"
  | "worker"
  | "server"
  | "serverless_function"
  | "postgresql"
  | "mysql"
  | "mongodb"
  | "redis"
  | "object_storage"
  | "kafka"
  | "rabbitmq"
  | "event_bus"
  | "external_api"
  | "payment_provider"
  | "auth_provider";

/** Connection protocol shown as an edge label. */
export type Protocol =
  | "http"
  | "https"
  | "grpc"
  | "tcp"
  | "ws"
  | "kafka"
  | "amqp"
  | "sql"
  | "redis"
  | "custom";

/** How a node picks among multiple outgoing connections. Mirrors the backend
 * `routingStrategy` enum; required at run time when a node has ≥2 outgoing edges. */
export type RoutingStrategy = "round_robin" | "random" | "least_connections";

export interface AutoscalingConfig {
  enabled: boolean;
  min: number;
  max: number;
  targetCpu: number;
}

export interface RetryPolicy {
  retries: number;
  circuitBreaker: boolean;
}

/** Live, simulation-only telemetry (never persisted). cpu/memory are absent when
 * the metric is not provided by the backend (the simulator does not report them). */
export interface NodeLiveMetrics {
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  cpu?: number;
  memory?: number;
}

export interface EdgeLiveMetrics {
  rps: number;
  latency: number;
  errors: number;
}

/** Data carried by every canvas node. */
export interface EditorNodeData extends Record<string, unknown> {
  label: string;
  kind: ComponentKind;
  health: Health;

  // Configuration (persisted)
  replicas: number;
  cpu: number;
  memory: number;
  autoscaling: AutoscalingConfig;
  region: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  routingStrategy: RoutingStrategy;

  // Baseline telemetry (persisted, used pre-simulation)
  traffic: number; // requests / sec
  latencyMs: number; // baseline p95-ish
  capacity?: number;
  concurrency?: number;
  errorRate?: number; // 0..1

  // Transient live metrics (not persisted)
  live?: NodeLiveMetrics;
}

/** Data carried by every canvas edge. */
export interface EditorEdgeData extends Record<string, unknown> {
  protocol: Protocol;
  trafficRate: number; // requests / sec
  latencyMs: number;

  live?: EdgeLiveMetrics;
}

export type EditorNode = Node<EditorNodeData, "component">;
export type EditorEdge = Edge<EditorEdgeData, "connection">;

/** Aggregated, architecture-wide telemetry shown in the bottom bar. cpu/memory
 * are undefined when unavailable (backend runs do not report them). */
export interface ArchitectureTelemetry {
  traffic: number; // req/s
  p95: number; // ms
  errorRate: number; // 0..1
  cpu?: number; // %
  memory?: number; // %
  cost: number; // $/mo
}

/** Serialized node as accepted by the backend. */
export interface SerializedNode {
  id: string;
  type: ComponentKind;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  config: Record<string, unknown>;
}
