import type {
  ComponentHealthMetrics,
  ComponentMetrics,
  SimulationMetrics,
  SimulationStatus,
} from "@/lib/api/simulations";
import type { Health } from "@/lib/health";
import { computeBaselineTelemetry } from "@/features/editor/telemetry";
import type {
  ArchitectureTelemetry,
  EditorNode,
  NodeLiveMetrics,
} from "@/features/editor/types";

export function isActiveStatus(status: SimulationStatus): boolean {
  return status === "created" || status === "running" || status === "paused";
}

export function isTerminalStatus(status: SimulationStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function statusLabel(status: SimulationStatus): string {
  switch (status) {
    case "created":
      return "Ready";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export type StatusTone = "neutral" | "active" | "success" | "warning" | "danger";

export function statusTone(status: SimulationStatus): StatusTone {
  switch (status) {
    case "created":
      return "neutral";
    case "running":
      return "active";
    case "paused":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "cancelled":
      return "neutral";
  }
}

export function runProgressPercent(
  currentTimeMs: number,
  durationMs: number | null,
): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (currentTimeMs / durationMs) * 100));
}

export function componentHealthToHealth(
  state: ComponentHealthMetrics["state"],
): Health {
  if (state === "failed") return "critical";
  return state;
}

function requestsPerSecond(
  processed: number,
  processedDurationMs: number,
): number {
  if (processedDurationMs <= 0) return 0;
  return processed / (processedDurationMs / 1000);
}

export function metricsToTelemetry(
  metrics: SimulationMetrics,
  nodes: EditorNode[],
): ArchitectureTelemetry {
  const seconds = metrics.processedDurationMs / 1000;
  const traffic = seconds > 0 ? metrics.requests.completed / seconds : 0;
  return {
    traffic,
    p95: metrics.latency.endToEnd.p95Ms,
    errorRate: metrics.requests.errorRate,
    cpu: undefined,
    memory: undefined,
    cost: computeBaselineTelemetry(nodes).cost,
  };
}

export function componentMetricsToLive(
  component: ComponentMetrics,
  processedDurationMs: number,
): NodeLiveMetrics {
  return {
    rps: requestsPerSecond(
      component.traffic.processed,
      processedDurationMs,
    ),
    p50: component.latency.p50Ms,
    p95: component.latency.p95Ms,
    p99: component.latency.p99Ms,
    errorRate:
      component.traffic.attempts > 0
        ? component.traffic.failedAttempts / component.traffic.attempts
        : 0,
  };
}

export function metricsToNodeLive(
  metrics: SimulationMetrics,
): Record<string, NodeLiveMetrics> {
  const result: Record<string, NodeLiveMetrics> = {};
  for (const [nodeId, component] of Object.entries(metrics.components)) {
    result[nodeId] = componentMetricsToLive(
      component,
      metrics.processedDurationMs,
    );
  }
  return result;
}

export function metricsToNodeHealth(
  metrics: SimulationMetrics,
): Record<string, Health> {
  const result: Record<string, Health> = {};
  for (const [nodeId, component] of Object.entries(metrics.components)) {
    result[nodeId] = componentHealthToHealth(component.health.state);
  }
  return result;
}
