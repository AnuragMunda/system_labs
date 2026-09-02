import { RuntimeComponentHealth } from "@/domain/architecture/component.types.js";

export interface ComponentRuntimeState {
  nodeId: string;
  health: RuntimeComponentHealth;
  activeRequests: number; // Number of requests currently being processed.
  processedRequests: number; // Total number of requests successfully processed.
}
