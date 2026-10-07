/**
 * @file event-queue.ts
 *
 * @description A min-heap priority queue for simulation events, ordered by
 * timestamp with ties broken by insertion sequence. The simulation engine pops
 * events in chronological order from this queue as the simulation clock
 * advances; same-timestamp events are dequeued in the order they were enqueued.
 *
 * Ordering contract:
 *
 *   1. `timestampMs` ascending (the primary key).
 *   2. For equal timestamps, insertion sequence ascending — every enqueued
 *      event receives a monotonically increasing sequence number, so
 *      `(timestamp=100, sequence=7)` always dequeues before
 *      `(timestamp=100, sequence=8)`.
 *
 * Ordering never depends on event `id`, `type`, `payload`, object property
 * iteration order, or any other incidental behavior: the sequence number is
 * the sole tie-breaker. Events scheduled while processing (same-timestamp or
 * not) receive later sequences than everything already queued, so they run
 * after their peers — causal FIFO within a timestamp.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";

/** Internal wrapper pairing an event with its insertion sequence number. */
interface QueuedEvent {
  event: SimulationEvent;
  sequence: number;
}

/**
 * Binary min-heap backed by an array, ordering `SimulationEvent`s by their
 * `timestampMs`, then by an insertion sequence so equal-timestamp events keep
 * FIFO order. Enqueue and dequeue are O(log n); peek is O(1).
 */
export class EventQueue {
  private events: QueuedEvent[] = [];
  private nextSequence = 0;

  /**
   * Wraps the event with the next sequence number and sifts it into place.
   *
   * @throws {Error} If `timestampMs` is not a finite, non-negative number. A
   *   `NaN` or `Infinity` timestamp would poison every heap comparison and
   *   silently destroy ordering, so it is rejected at the boundary instead.
   */
  enqueue(event: SimulationEvent): void {
    if (!Number.isFinite(event.timestampMs) || event.timestampMs < 0) {
      throw new Error(
        `Event timestamp must be a finite, non-negative number. Received: ${event.timestampMs}.`,
      );
    }

    const queuedEvent: QueuedEvent = {
      event,
      sequence: this.nextSequence++,
    };

    this.events.push(queuedEvent);
    this.bubbleUp(this.events.length - 1);
  }

  /** Removes and returns the earliest event, or undefined when empty. */
  dequeue(): SimulationEvent | undefined {
    if (this.events.length === 0) {
      return undefined;
    }

    if (this.events.length === 1) {
      return this.events.pop()!.event;
    }

    const firstEvent = this.events[0]!;

    // Move the last element to the root, then sift it down so the next
    // earliest event rises to the top.

    const lastEvent = this.events.pop()!;

    this.events[0] = lastEvent;
    this.bubbleDown(0);

    return firstEvent.event;
  }

  /** Returns the earliest event without removing it, or undefined when empty. */
  peek(): SimulationEvent | undefined {
    return this.events[0]?.event;
  }

  /** Returns true when the queue holds no events. */
  isEmpty(): boolean {
    return this.events.length === 0;
  }

  /** Returns the number of events currently in the queue. */
  size(): number {
    return this.events.length;
  }

  /** Discards all queued events and resets the sequence counter. */
  clear(): void {
    this.events = [];
    this.nextSequence = 0;
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

  /**
   * Orders events by timestamp first; equal timestamps fall back to the
   * insertion sequence so ordering stays deterministic and stable.
   */
  private compare(a: QueuedEvent, b: QueuedEvent): number {
    const timestampDifference = a.event.timestampMs - b.event.timestampMs;

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return a.sequence - b.sequence;
  }

  /** Swaps the events at positions `a` and `b`. */
  private swap(a: number, b: number): void {
    [this.events[a], this.events[b]] = [this.events[b]!, this.events[a]!];
  }
}
