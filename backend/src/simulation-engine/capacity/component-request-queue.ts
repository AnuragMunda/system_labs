/**
 * @file component-request-queue.ts
 *
 * @description Implements a per-component FIFO request queue used during
 * simulation.
 *
 * Each component node (identified by `nodeId`) maintains its own independent
 * queue of request IDs. Requests are dequeued in the same order they were
 * enqueued (first-in, first-out).
 */
export class ComponentRequestQueue {
  private readonly queues = new Map<string, string[]>();

  /**
   * Append a request to the back of the queue for the given component.
   *
   * @param nodeId   - The component node identifier.
   * @param requestId - The request to enqueue.
   */
  enqueue(nodeId: string, requestId: string): void {
    const queue = this.queues.get(nodeId) ?? [];

    queue.push(requestId);
    this.queues.set(nodeId, queue);
  }

  /**
   * Remove and return the request at the front of the queue for the given
   * component, or return `undefined` when the queue is empty or missing.
   *
   * When the last request is dequeued the internal queue entry is cleaned up
   * to avoid unbounded memory growth.
   *
   * @param nodeId - The component node identifier.
   * @returns The next request ID, or `undefined` if nothing is queued.
   */
  dequeue(nodeId: string): string | undefined {
    const queue = this.queues.get(nodeId);

    if (!queue || queue.length === 0) {
      return undefined;
    }

    const requestId = queue.shift();

    if (queue.length === 0) {
      this.queues.delete(nodeId);
    }
    return requestId;
  }

  /**
   * Return the number of requests waiting in the queue for the given
   * component. Returns `0` when the queue does not exist.
   *
   * @param nodeId - The component node identifier.
   */
  size(nodeId: string): number {
    return this.queues.get(nodeId)?.length ?? 0;
  }

  /** Remove all queued requests across every component. */
  clear(): void {
    this.queues.clear();
  }
}
