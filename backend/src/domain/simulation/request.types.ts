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

/** The database operation a request performs against a database node. */
export type DatabaseOperation = "read" | "write";

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

  /**
   * The database operation this request performs against a database component
   * (for example `"read"` or `"write"`). Assigned deterministically when the
   * request is created; independent of the request id. A request that reaches
   * a database without one defaults to `"read"`.
   */
  databaseOperation?: DatabaseOperation;

  /**
   * The request payload size in bytes, used to approximate the time a network
   * transmission takes over a bandwidth-limited connection. Defaults to
   * `DEFAULT_REQUEST_SIZE_BYTES` when absent.
   */
  sizeBytes?: number;
}
