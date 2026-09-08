export type RequestStatus = "pending" | "in-flight" | "completed" | "failed";

export interface SimulationRequest {
  id: string;
  status: RequestStatus;

  createdAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;

  currentNodeId?: string;
  attempts: number;
}
