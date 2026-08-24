import { EventQueue } from "@/simulation-engine/core/event-queue.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";
import { describe, expect, it } from "vitest";

function createEvent(id: string, timestampMs: number): SimulationEvent {
  return {
    id,
    simulationId: "simulation-1",
    timestampMs,
    type: "request.created",
  };
}

describe("EventQueue", () => {
  it("should start empty", () => {
    const queue = new EventQueue();

    expect(queue.isEmpty()).toBe(true);
    expect(queue.size()).toBe(0);
    expect(queue.peek()).toBeUndefined();
    expect(queue.dequeue()).toBeUndefined();
  });

  it("should enqueue and dequeue an event", () => {
    const queue = new EventQueue();

    const event = createEvent("event-1", 100);

    queue.enqueue(event);

    expect(queue.size()).toBe(1);
    expect(queue.isEmpty()).toBe(false);
    expect(queue.peek()).toBe(event);
    expect(queue.dequeue()).toBe(event);

    expect(queue.isEmpty()).toBe(true);
  });

  it("should return events in timestamp order", () => {
    const queue = new EventQueue();

    const event1 = createEvent("event-1", 50);
    const event2 = createEvent("event-2", 10);
    const event3 = createEvent("event-3", 30);
    const event4 = createEvent("event-4", 5);

    queue.enqueue(event1);
    queue.enqueue(event2);
    queue.enqueue(event3);
    queue.enqueue(event4);

    expect(queue.dequeue()?.id).toBe("event-4");
    expect(queue.dequeue()?.id).toBe("event-2");
    expect(queue.dequeue()?.id).toBe("event-3");
    expect(queue.dequeue()?.id).toBe("event-1");
  });

  it("should not remove an event when peeking", () => {
    const queue = new EventQueue();

    const event = createEvent("event-1", 100);

    queue.enqueue(event);

    expect(queue.peek()).toBe(event);
    expect(queue.size()).toBe(1);
    expect(queue.peek()).toBe(event);
  });

  it("should clear all events", () => {
    const queue = new EventQueue();

    queue.enqueue(createEvent("event-1", 10));
    queue.enqueue(createEvent("event-2", 20));
    queue.enqueue(createEvent("event-3", 30));

    expect(queue.size()).toBe(3);

    queue.clear();

    expect(queue.size()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.peek()).toBeUndefined();
    expect(queue.dequeue()).toBeUndefined();
  });

  it("should maintain ordering with many events", () => {
    const queue = new EventQueue();

    const timestamps = [500, 20, 900, 10, 300, 100, 700, 50, 250, 1];

    timestamps.forEach((timestamp, index) => {
      queue.enqueue(createEvent(`event-${index}`, timestamp));
    });

    const result: number[] = [];

    while (!queue.isEmpty()) {
      result.push(queue.dequeue()!.timestampMs);
    }

    expect(result).toEqual([1, 10, 20, 50, 100, 250, 300, 500, 700, 900]);
  });
});
