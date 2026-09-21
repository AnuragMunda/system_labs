/**
 * The lifecycle status of a request during a simulation.
 *
 * - `"pending"`   - created but not yet routed.
 * - `"in-flight"` - currently being processed or travelling between nodes.
 * - `"queued"`    - waiting in a component's queue for a free processing slot.
 * - `"completed"` - finished successfully.
 * - `"failed"`    - failed and will not be retried further.
 */
export type RequestStatus =
  "pending" | "in-flight" | "queued" | "completed" | "failed";

export interface SimulationRequest {
  id: string;
  status: RequestStatus;

  createdAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;

  currentNodeId?: string;
  attempts: number;
}
