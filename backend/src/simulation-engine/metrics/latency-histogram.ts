/**
 * @file latency-histogram.ts
 *
 * @description A bounded, fixed-bucket latency histogram used to derive
 * aggregate latency summaries (average, percentiles) from a stream of latency
 * samples.
 *
 * The buckets are log-spaced (powers of sqrt(2)) so a single fixed-size array
 * covers sub-millisecond to multi-minute latencies with a bounded memory
 * footprint, regardless of how many samples are recorded. Average, total, and
 * min/max are tracked exactly; percentiles are estimated by linear
 * interpolation inside the bucket that contains the target rank. Both the
 * buckets and the interpolation are fully deterministic, so identical sample
 * streams always produce identical summaries.
 */

import { LatencySummary } from "@/domain/simulation/metrics.types.js";

/** Number of log-spaced buckets. Covers ~0.5ms up to ~500 seconds. */
export const LATENCY_HISTOGRAM_BUCKET_COUNT = 41;

/** Lower bound (in ms) of the first bucket; buckets are `value * sqrt(2)` apart. */
const FIRST_BUCKET_LOW = 0.5;

function bucketBoundary(index: number): number {
  return FIRST_BUCKET_LOW * Math.pow(Math.SQRT2, index);
}

/** Latency below an integral number of milliseconds is quantized for display. */
export function roundLatency(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Describes a bounded, mergeable latency histogram. */
export class LatencyHistogram {
  private readonly buckets: number[];
  private sampleCount = 0;
  private latencyTotalMs = 0;
  private lowestSeenMs = Infinity;
  private highestSeenMs = -Infinity;

  constructor() {
    this.buckets = new Array<number>(LATENCY_HISTOGRAM_BUCKET_COUNT).fill(0);
  }

  get count(): number {
    return this.sampleCount;
  }

  get totalMs(): number {
    return this.latencyTotalMs;
  }

  /** Records a single latency sample in milliseconds. */
  record(valueMs: number): void {
    if (!Number.isFinite(valueMs) || valueMs < 0) {
      throw new Error(
        `Latency samples must be finite and non-negative: ${valueMs}`,
      );
    }

    const index = this.bucketIndex(valueMs);
    this.buckets[index] = (this.buckets[index] ?? 0) + 1;
    this.sampleCount++;
    this.latencyTotalMs += valueMs;

    if (valueMs < this.lowestSeenMs) this.lowestSeenMs = valueMs;
    if (valueMs > this.highestSeenMs) this.highestSeenMs = valueMs;
  }

  /** Combines another histogram's buckets and totals into this one. */
  merge(other: LatencyHistogram): void {
    for (let i = 0; i < this.buckets.length; i++) {
      const first = this.buckets[i] ?? 0;
      const second = other.buckets[i] ?? 0;
      this.buckets[i] = first + second;
    }

    this.sampleCount += other.sampleCount;
    this.latencyTotalMs += other.latencyTotalMs;

    if (other.lowestSeenMs < this.lowestSeenMs) {
      this.lowestSeenMs = other.lowestSeenMs;
    }

    if (other.highestSeenMs > this.highestSeenMs) {
      this.highestSeenMs = other.highestSeenMs;
    }
  }

  /** Returns an independent copy of this histogram. */
  clone(): LatencyHistogram {
    const copy = new LatencyHistogram();

    for (let i = 0; i < this.buckets.length; i++) {
      copy.buckets[i] = this.buckets[i] ?? 0;
    }

    copy.sampleCount = this.sampleCount;
    copy.latencyTotalMs = this.latencyTotalMs;
    copy.lowestSeenMs = this.lowestSeenMs;
    copy.highestSeenMs = this.highestSeenMs;

    return copy;
  }

  /** Builds a zero-safe {@link LatencySummary} from the recorded samples. */
  summary(): LatencySummary {
    if (this.sampleCount === 0) {
      return {
        count: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        minMs: 0,
        maxMs: 0,
      };
    }

    return {
      count: this.sampleCount,
      avgMs: roundLatency(this.latencyTotalMs / this.sampleCount),
      p50Ms: roundLatency(this.percentile(0.5)),
      p95Ms: roundLatency(this.percentile(0.95)),
      p99Ms: roundLatency(this.percentile(0.99)),
      minMs: this.lowestSeenMs,
      maxMs: this.highestSeenMs,
    };
  }

  /** Maps a latency value to its bucket index, clamped to the last bucket. */
  private bucketIndex(valueMs: number): number {
    if (valueMs < FIRST_BUCKET_LOW) {
      return 0;
    }

    const index = Math.floor(2 * Math.log2(valueMs / FIRST_BUCKET_LOW));

    return Math.max(0, Math.min(index, LATENCY_HISTOGRAM_BUCKET_COUNT - 1));
  }

  /**
   * Estimates the latency at the given fraction (0-1) by walking the
   * cumulative bucket counts and linearly interpolating inside the bucket that
   * contains the target rank.
   */
  private percentile(fraction: number): number {
    const rank = Math.max(1, Math.ceil(fraction * this.sampleCount));

    let cumulative = 0;

    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.buckets[i] ?? 0;

      if (cumulative >= rank) {
        return this.estimateInBucket(
          i,
          rank,
          cumulative - (this.buckets[i] ?? 0),
        );
      }
    }

    return this.bucketBoundaryHigh(LATENCY_HISTOGRAM_BUCKET_COUNT - 1);
  }

  private estimateInBucket(
    bucketIndex: number,
    rank: number,
    beforeBucket: number,
  ): number {
    const inBucket = this.buckets[bucketIndex] ?? 0;

    const low = bucketBoundary(bucketIndex);
    const high = bucketBoundary(bucketIndex + 1);

    const position = Math.max(
      0,
      Math.min((rank - beforeBucket - 1) / Math.max(inBucket - 1, 1), 1),
    );

    return low + position * (high - low);
  }

  private bucketBoundaryHigh(bucketIndex: number): number {
    return bucketBoundary(bucketIndex + 1);
  }
}
