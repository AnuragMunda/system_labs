/**
 * @file simulation-cache.ts
 *
 * @description Per-component LRU cache used during simulation. Entries expire
 * after the configured TTL and are evicted with a least-recently-used policy
 * when the cache reaches capacity. The cache also tracks hit, miss, and
 * eviction counters, which make up the cache-specific metrics of a run.
 */

import type { CacheEntry, CacheState } from "../utils/types.js";

export class SimulationCache {
  private readonly state: CacheState;

  /**
   * @param capacity - Maximum number of entries the cache holds. Must be a
   *   finite positive number.
   * @param ttlMs    - Entry time-to-live in milliseconds. Must be a finite
   *   non-negative number; `0` means entries never expire.
   * @throws {Error} If `capacity` is not a finite positive number or `ttlMs`
   *   is not a finite number greater than or equal to zero.
   */
  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
  ) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(
        `Cache capacity must be a finite positive number: ${capacity}`,
      );
    }

    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error(`Cache TTL must be a finite number >= 0: ${ttlMs}`);
    }

    this.state = {
      entries: new Map(),
      hits: 0,
      misses: 0,
      evictions: 0,
    };
  }

  get size(): number {
    return this.state.entries.size;
  }

  get hits(): number {
    return this.state.hits;
  }

  get misses(): number {
    return this.state.misses;
  }

  get evictions(): number {
    return this.state.evictions;
  }

  get(key: string, currentTimeMs: number): CacheEntry | undefined {
    const entry = this.state.entries.get(key);

    if (!entry) {
      this.state.misses++;
      return undefined;
    }

    if (this.isExpired(entry, currentTimeMs)) {
      this.state.entries.delete(key);
      this.state.misses++;
      return undefined;
    }

    entry.lastAccessedAtMs = currentTimeMs;

    this.state.hits++;

    return entry;
  }

  set(key: string, value: unknown, currentTimeMs: number): void {
    const expiresAtMs =
      this.ttlMs === 0 ? Number.POSITIVE_INFINITY : currentTimeMs + this.ttlMs;

    const existing = this.state.entries.get(key);

    if (existing) {
      existing.value = value;
      existing.createdAtMs = currentTimeMs;
      existing.expiresAtMs = expiresAtMs;
      existing.lastAccessedAtMs = currentTimeMs;

      return;
    }

    if (this.state.entries.size >= this.capacity) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CacheEntry = {
      key,
      value,
      createdAtMs: currentTimeMs,
      expiresAtMs,
      lastAccessedAtMs: currentTimeMs,
    };

    this.state.entries.set(key, entry);
  }

  delete(key: string): boolean {
    return this.state.entries.delete(key);
  }

  has(key: string, currentTimeMs: number): boolean {
    return this.get(key, currentTimeMs) !== undefined;
  }

  clear(): void {
    this.state.entries.clear();
    this.state.hits = 0;
    this.state.misses = 0;
    this.state.evictions = 0;
  }

  private isExpired(entry: CacheEntry, currentTimeMs: number): boolean {
    return currentTimeMs >= entry.expiresAtMs;
  }

  private evictLeastRecentlyUsed(): void {
    let leastRecentlyUsed: CacheEntry | undefined;

    for (const entry of this.state.entries.values()) {
      if (
        !leastRecentlyUsed ||
        entry.lastAccessedAtMs < leastRecentlyUsed.lastAccessedAtMs
      ) {
        leastRecentlyUsed = entry;
      }
    }

    if (!leastRecentlyUsed) {
      return;
    }

    this.state.entries.delete(leastRecentlyUsed.key);
    this.state.evictions++;
  }
}
