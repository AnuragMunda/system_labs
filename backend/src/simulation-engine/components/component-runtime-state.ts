import { RuntimeComponentHealth } from "@/domain/architecture/component.types.js";

export interface ComponentRuntimeState {
  nodeId: string;
  health: RuntimeComponentHealth;

  activeRequests: number; // Number of requests currently being processed.
  processedRequests: number; // Total number of requests successfully processed.

  totalProcessingAttempts: number; // Total processing attempts (successes and failures).
  failedProcessingAttempts: number; // Processing attempts that failed (errorRate-driven).

  totalProcessingLatencyMs: number; // Cumulative processing latency for completed requests.
  lastProcessingLatencyMs?: number; // Latency of the most recently completed request.

  effectiveConcurrency: number; // Max requests processable concurrently (replicas * concurrency).

  recoveryGeneration: number; // Identifies the current failure/recovery cycle.
}
