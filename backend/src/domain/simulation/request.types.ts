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

  /**
   * The stable resource key a cache component uses to look this request up
   * (for example `GET:/users/123`). Assigned deterministically when the
   * request is created; independent of the request id.
   */
  cacheKey?: string;

  /**
   * Set when the request missed a cache lookup and entered the cache's
   * capacity-bound processing path. Survives retries and queue admission so
   * every later transition still knows the request is on the miss path.
   */
  cacheMiss?: boolean;
}
