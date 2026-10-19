import { apiFetch } from "./http";

export type SimulationStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type DatabaseOperation = "read" | "write";

export interface ScheduledFailure {
  nodeId: string;
  failedAtMs: number;
}

export interface SimulationConfig {
  durationMs: number;
  requestsPerSecond: number;
  simulationSpeed?: number;
  randomSeed?: number;
  collectMetrics?: boolean;
  emitEvents?: boolean;
  cacheKeys?: string[];
  databaseOperations?: DatabaseOperation[];
  failures?: ScheduledFailure[];
}

export interface SimulationNode {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface SimulationEdge {
  id: string;
  source: string;
  target: string;
  config: Record<string, unknown>;
}

export interface SimulationGraph {
  nodes: SimulationNode[];
  edges: SimulationEdge[];
}

export interface SimulationDetails {
  id: string;
  architectureId: string;
  status: SimulationStatus;
  seed: number | null;
  currentTimeMs: number;
  sourceNodeId: string | null;
  config: SimulationConfig | null;
  snapshot: SimulationGraph | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface SimulationStatusView {
  id: string;
  status: SimulationStatus;
  currentTimeMs: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface SimulationSummary extends SimulationStatusView {
  architectureId: string;
  seed: number | null;
  createdAt: string;
}

export interface LatencySummary {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

export interface RequestMetrics {
  generated: number;
  completed: number;
  failed: number;
  retries: number;
  inFlight: number;
  queued: number;
  successRate: number;
  errorRate: number;
  failedByReason: Record<string, number>;
}

export interface FailureMetrics {
  total: number;
  byReason: Record<string, number>;
  byNode: Record<string, number>;
}

export interface ComponentTrafficMetrics {
  active: number;
  peakActive: number;
  processed: number;
  attempts: number;
  failedAttempts: number;
  retries: number;
}

export interface ComponentLatencyMetrics {
  totalMs: number;
  avgMs: number;
  lastMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ComponentHealthMetrics {
  state: "healthy" | "degraded" | "critical" | "failed";
  transitions: number;
  failures: number;
  recoveries: number;
  timeInStateMs: Record<string, number>;
}

export interface ComponentQueueMetrics {
  currentDepth: number;
  peakDepth: number;
  totalEnqueued: number;
  totalDequeued: number;
  totalDropped: number;
  totalRejected: number;
  wait: LatencySummary;
}

export interface ComponentMetrics {
  nodeId: string;
  type: string;
  traffic: ComponentTrafficMetrics;
  latency: ComponentLatencyMetrics;
  queue: ComponentQueueMetrics;
  health: ComponentHealthMetrics;
}

export interface SimulationMetrics {
  simulationId: string;
  durationMs: number;
  processedDurationMs: number;
  recordedAtMs: number;
  collectMetrics: boolean;
  requests: RequestMetrics;
  failures: FailureMetrics;
  network: {
    transmissions: number;
    packetLosses: number;
    packetLossRate: number;
    totalLatencyMs: number;
  };
  latency: {
    endToEnd: LatencySummary;
    failed: LatencySummary;
    network: LatencySummary;
  };
  components: Record<string, ComponentMetrics>;
}

export interface SimulationResultView {
  simulation: SimulationDetails;
  metrics: SimulationMetrics;
}

export interface PaginatedSimulations {
  items: SimulationSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateSimulationInput {
  architectureId: string;
  sourceNodeId: string;
  config: SimulationConfig;
}

export interface ListSimulationsParams {
  architectureId?: string;
  projectId?: string;
  page?: number;
  limit?: number;
}

export async function createSimulationApi(
  input: CreateSimulationInput,
): Promise<SimulationDetails> {
  return apiFetch<SimulationDetails>("/api/v1/simulations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listSimulationsApi(
  params: ListSimulationsParams = {},
): Promise<PaginatedSimulations> {
  const query = new URLSearchParams();
  if (params.architectureId)
    query.set("architectureId", params.architectureId);
  if (params.projectId) query.set("projectId", params.projectId);
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? 100));
  return apiFetch<PaginatedSimulations>(
    `/api/v1/simulations?${query.toString()}`,
  );
}

export async function getSimulationApi(id: string): Promise<SimulationDetails> {
  return apiFetch<SimulationDetails>(
    `/api/v1/simulations/${encodeURIComponent(id)}`,
  );
}

export async function getSimulationStatusApi(
  id: string,
): Promise<SimulationStatusView> {
  return apiFetch<SimulationStatusView>(
    `/api/v1/simulations/${encodeURIComponent(id)}/status`,
  );
}

export async function getSimulationResultsApi(
  id: string,
): Promise<SimulationResultView> {
  return apiFetch<SimulationResultView>(
    `/api/v1/simulations/${encodeURIComponent(id)}/results`,
  );
}

export async function getSimulationMetricsApi(
  id: string,
): Promise<SimulationMetrics> {
  return apiFetch<SimulationMetrics>(
    `/api/v1/simulations/${encodeURIComponent(id)}/metrics`,
  );
}

export async function startSimulationApi(
  id: string,
): Promise<SimulationDetails> {
  return apiFetch<SimulationDetails>(
    `/api/v1/simulations/${encodeURIComponent(id)}/start`,
    { method: "POST" },
  );
}

export async function pauseSimulationApi(
  id: string,
): Promise<SimulationDetails> {
  return apiFetch<SimulationDetails>(
    `/api/v1/simulations/${encodeURIComponent(id)}/pause`,
    { method: "POST" },
  );
}

export async function resumeSimulationApi(
  id: string,
): Promise<SimulationDetails> {
  return apiFetch<SimulationDetails>(
    `/api/v1/simulations/${encodeURIComponent(id)}/resume`,
    { method: "POST" },
  );
}

export async function cancelSimulationApi(
  id: string,
): Promise<SimulationDetails> {
  return apiFetch<SimulationDetails>(
    `/api/v1/simulations/${encodeURIComponent(id)}/cancel`,
    { method: "POST" },
  );
}

export function isTerminalStatus(status: SimulationStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
