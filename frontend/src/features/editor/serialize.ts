// Conversions between the editor's React Flow models (EditorNode / EditorEdge)
// and the backend wire format (BackendArchitectureNode / BackendArchitectureEdge).
import type {
  BackendArchitectureEdge,
  BackendArchitectureNode,
} from "@/lib/api/architectures";
import { getCatalogItem } from "./catalog";
import type {
  ComponentKind,
  EditorEdge,
  EditorEdgeData,
  EditorNode,
  EditorNodeData,
  Protocol,
  RoutingStrategy,
} from "./types";
import type { Health } from "@/lib/health";

const ROUTING_STRATEGIES: RoutingStrategy[] = [
  "round_robin",
  "random",
  "least_connections",
];

function routing(value: unknown, fallback: RoutingStrategy): RoutingStrategy {
  return typeof value === "string" &&
    (ROUTING_STRATEGIES as string[]).includes(value)
    ? (value as RoutingStrategy)
    : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Builds a fresh node data object for `kind`, merging catalog defaults. */
export function buildNodeData(kind: ComponentKind, label?: string): EditorNodeData {
  const item = getCatalogItem(kind);
  const d = item?.defaults ?? {};
  return {
    label: label ?? item?.label ?? kind,
    kind,
    health: "healthy",
    replicas: num(d.replicas, 2),
    cpu: num(d.cpu, 2),
    memory: num(d.memory, 4),
    autoscaling: d.autoscaling ?? {
      enabled: false,
      min: 1,
      max: 10,
      targetCpu: 70,
    },
    region: str(d.region, "us-east-1"),
    timeoutMs: num(d.timeoutMs, 500),
    retryPolicy: d.retryPolicy ?? { retries: 3, circuitBreaker: true },
    routingStrategy: routing(d.routingStrategy, "round_robin"),
    traffic: num(d.traffic, 0),
    latencyMs: num(d.latencyMs, 20),
    capacity: optNum(d.capacity),
    concurrency: optNum(d.concurrency),
    errorRate: optNum(d.errorRate),
  };
}

/** Creates a new editor node of `kind` at the given canvas position. */
export function createNode(
  kind: ComponentKind,
  position: { x: number; y: number },
  label?: string,
): EditorNode {
  return {
    id: crypto.randomUUID(),
    type: "component",
    position,
    data: buildNodeData(kind, label),
  };
}

/** Converts an editor node into the backend wire format. */
export function serializeNode(node: EditorNode): BackendArchitectureNode {
  const d = node.data;
  return {
    id: node.id,
    type: d.kind,
    name: d.label,
    position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    config: {
      latencyMs: d.latencyMs,
      capacity: d.capacity,
      concurrency: d.concurrency,
      errorRate: d.errorRate,
      replicas: d.replicas,
      cpu: d.cpu,
      memory: d.memory,
      autoscaling: d.autoscaling,
      region: d.region,
      timeoutMs: d.timeoutMs,
      retryPolicy: d.retryPolicy,
      routingStrategy: d.routingStrategy,
      traffic: d.traffic,
      health: d.health,
    },
  };
}

/** Converts a backend node into an editor node, filling gaps from catalog defaults. */
export function deserializeNode(n: BackendArchitectureNode): EditorNode {
  const c = n.config ?? {};
  const kind = (str(c.type, n.type) as ComponentKind) ?? "api";
  const item = getCatalogItem(kind);
  const d = item?.defaults ?? {};
  const health = (str(c.health, "healthy") as Health) ?? "healthy";
  return {
    id: n.id,
    type: "component",
    position: { x: num(n.position?.x, 0), y: num(n.position?.y, 0) },
    data: {
      label: n.name,
      kind,
      health,
      replicas: num(c.replicas, num(d.replicas, 2)),
      cpu: num(c.cpu, num(d.cpu, 2)),
      memory: num(c.memory, num(d.memory, 4)),
      autoscaling:
        (c.autoscaling as EditorNodeData["autoscaling"]) ??
        d.autoscaling ?? { enabled: false, min: 1, max: 10, targetCpu: 70 },
      region: str(c.region, str(d.region, "us-east-1")),
      timeoutMs: num(c.timeoutMs, num(d.timeoutMs, 500)),
      retryPolicy:
        (c.retryPolicy as EditorNodeData["retryPolicy"]) ??
        d.retryPolicy ?? { retries: 3, circuitBreaker: true },
      routingStrategy: routing(c.routingStrategy, "round_robin"),
      traffic: num(c.traffic, num(d.traffic, 0)),
      latencyMs: num(c.latencyMs, num(d.latencyMs, 20)),
      capacity: optNum(c.capacity),
      concurrency: optNum(c.concurrency),
      errorRate: optNum(c.errorRate),
    },
  };
}

/** Converts an editor edge into the backend wire format. */
export function serializeEdge(edge: EditorEdge): BackendArchitectureEdge {
  const d = edge.data ?? ({} as EditorEdgeData);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    config: {
      latencyMs: d.latencyMs,
      protocol: d.protocol,
      trafficRate: d.trafficRate,
    },
  };
}

/** Converts a backend edge into an editor edge. */
export function deserializeEdge(e: BackendArchitectureEdge): EditorEdge {
  const c = e.config ?? {};
  const protocol = (str(c.protocol, "http") as Protocol) ?? "http";
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: "connection",
    data: {
      protocol,
      trafficRate: num(c.trafficRate, 0),
      latencyMs: num(c.latencyMs, 10),
    },
  };
}
