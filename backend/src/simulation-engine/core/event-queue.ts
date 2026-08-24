/**
 * @file event-queue.ts
 *
 * @description A min-heap priority queue for simulation events, ordered by
 * timestamp. The simulation engine pops events in chronological order from
 * this queue as the simulation clock advances.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";

/**
 * Binary min-heap backed by an array, ordering `SimulationEvent`s by their
 * `timestampMs`. Enqueue and dequeue are O(log n); peek is O(1).
 */
export class EventQueue {
  private events: SimulationEvent[] = [];

  /** Appends an event to the heap and sifts it up to restore heap order. */
  enqueue(event: SimulationEvent): void {
    this.events.push(event);
    this.bubbleUp(this.events.length - 1);
  }

  /** Removes and returns the earliest event, or undefined when empty. */
  dequeue(): SimulationEvent | undefined {
    if (this.isEmpty()) {
      return undefined;
    }

    if (this.events.length === 1) {
      return this.events.pop();
    }

    const firstEvent = this.events[0];

    // Move the last element to the root, then sift it down so the next
    // earliest event rises to the top.

    const lastEvent = this.events.pop()!;

    this.events[0] = lastEvent;
    this.bubbleDown(0);

    return firstEvent;
  }

  /** Returns the earliest event without removing it, or undefined when empty. */
  peek(): SimulationEvent | undefined {
    return this.events[0];
  }

  /** Returns true when the queue holds no events. */
  isEmpty(): boolean {
    return this.events.length === 0;
  }

  /** Returns the number of events currently in the queue. */
  size(): number {
    return this.events.length;
  }

  /** Discards all queued events. */
  clear(): void {
    this.events = [];
  }

  /** Sifts the event at `index` up while it is smaller than its parent. */
  private bubbleUp(index: number): void {
    let currentIndex = index;

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);

      if (
        this.compare(this.events[currentIndex]!, this.events[parentIndex]!) >= 0
      ) {
        break;
      }

      this.swap(currentIndex, parentIndex);
      currentIndex = parentIndex;
    }
  }

  /**
   * Sifts the event at `index` down by repeatedly swapping it with its
   * smallest child until both children are larger (or none exist).
   */
  private bubbleDown(index: number): void {
    let currentIndex = index;

    while (true) {
      const leftChildIndex = currentIndex * 2 + 1;
      const rightChildIndex = currentIndex * 2 + 2;

      let smallestIndex = currentIndex;

      if (
        leftChildIndex < this.events.length &&
        this.compare(
          this.events[leftChildIndex]!,
          this.events[smallestIndex]!,
        ) < 0
      ) {
        smallestIndex = leftChildIndex;
      }

      if (
        rightChildIndex < this.events.length &&
        this.compare(
          this.events[rightChildIndex]!,
          this.events[smallestIndex]!,
        ) < 0
      ) {
        smallestIndex = rightChildIndex;
      }

      if (smallestIndex === currentIndex) {
        break;
      }

      this.swap(currentIndex, smallestIndex);
      currentIndex = smallestIndex;
    }
  }

  /** Orders events by timestamp; negative when `a` precedes `b`. */
  private compare(a: SimulationEvent, b: SimulationEvent): number {
    return a.timestampMs - b.timestampMs;
  }

  /** Swaps the events at positions `a` and `b`. */
  private swap(a: number, b: number): void {
    const event = this.events[a]!;
    this.events[a] = this.events[b]!;
    this.events[b] = event;
  }
}
