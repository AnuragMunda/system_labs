import { ComponentRequestQueue } from "@/simulation-engine/capacity/component-request-queue.js";
import { describe, expect, it } from "vitest";

describe("ComponentRequestQueue", () => {
  it("should dequeue requests in FIFO order", () => {
    const queue = new ComponentRequestQueue();

    queue.enqueue("api", "A");
    queue.enqueue("api", "B");
    queue.enqueue("api", "C");

    expect(queue.dequeue("api")).toBe("A");
    expect(queue.dequeue("api")).toBe("B");
    expect(queue.dequeue("api")).toBe("C");
  });

  it("should return undefined when dequeueing from an empty queue", () => {
    const queue = new ComponentRequestQueue();

    expect(queue.dequeue("api")).toBeUndefined();
  });

  it("should return undefined when dequeueing from a non-existent node", () => {
    const queue = new ComponentRequestQueue();

    expect(queue.dequeue("unknown")).toBeUndefined();
  });

  it("should maintain independent queues per component", () => {
    const queue = new ComponentRequestQueue();

    queue.enqueue("api", "A");
    queue.enqueue("api", "B");
    queue.enqueue("worker", "C");
    queue.enqueue("worker", "D");

    expect(queue.dequeue("api")).toBe("A");
    expect(queue.dequeue("worker")).toBe("C");

    expect(queue.size("api")).toBe(1);
    expect(queue.size("worker")).toBe(1);
  });

  it("should report the correct size", () => {
    const queue = new ComponentRequestQueue();

    queue.enqueue("api", "A");
    queue.enqueue("api", "B");

    expect(queue.size("api")).toBe(2);

    queue.dequeue("api");

    expect(queue.size("api")).toBe(1);
  });

  it("should return 0 for size on a non-existent node", () => {
    const queue = new ComponentRequestQueue();

    expect(queue.size("unknown")).toBe(0);
  });

  it("should clear all queues", () => {
    const queue = new ComponentRequestQueue();

    queue.enqueue("api", "A");
    queue.enqueue("worker", "B");

    queue.clear();

    expect(queue.size("api")).toBe(0);
    expect(queue.size("worker")).toBe(0);
  });

  it("should clean up the internal queue entry when the last request is dequeued", () => {
    const queue = new ComponentRequestQueue();

    queue.enqueue("api", "A");
    expect(queue.dequeue("api")).toBe("A");

    expect(queue.size("api")).toBe(0);
    expect(queue.dequeue("api")).toBeUndefined();
  });
});
