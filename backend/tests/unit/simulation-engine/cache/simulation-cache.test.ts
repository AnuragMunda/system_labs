import { SimulationCache } from "@/simulation-engine/cache/simulation-cache.js";
import { describe, expect, it } from "vitest";

describe("SimulationCache", () => {
  it("should initialize with a valid capacity and TTL", () => {
    const cache = new SimulationCache(2, 1000);

    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
    expect(cache.evictions).toBe(0);
  });

  it("should reject a missing, zero, negative, or non-finite capacity", () => {
    expect(
      () => new SimulationCache(undefined as unknown as number, 1000),
    ).toThrow("Cache capacity must be a finite positive number");
    expect(() => new SimulationCache(0, 1000)).toThrow(
      "Cache capacity must be a finite positive number",
    );
    expect(() => new SimulationCache(-1, 1000)).toThrow(
      "Cache capacity must be a finite positive number",
    );
    expect(() => new SimulationCache(Number.NaN, 1000)).toThrow(
      "Cache capacity must be a finite positive number",
    );
  });

  it("should reject a negative, non-finite, or missing TTL", () => {
    expect(() => new SimulationCache(2, -1)).toThrow(
      "Cache TTL must be a finite number >= 0",
    );
    expect(() => new SimulationCache(2, Number.NaN)).toThrow(
      "Cache TTL must be a finite number >= 0",
    );
    expect(
      () => new SimulationCache(2, undefined as unknown as number),
    ).toThrow("Cache TTL must be a finite number >= 0");
  });

  it("should report a hit while a stored entry is within its TTL", () => {
    const cache = new SimulationCache(2, 1000);
    cache.set("GET:/users/123", { requestId: "req-1" }, 0);

    const entry = cache.get("GET:/users/123", 50);

    expect(entry?.value).toEqual({ requestId: "req-1" });
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(0);
  });

  it("should treat an expired entry as a miss and remove it", () => {
    const cache = new SimulationCache(2, 100);
    cache.set("KEY", "value", 0);

    expect(cache.get("KEY", 99)?.value).toBe("value");

    // currentTimeMs === expiresAtMs is already past the TTL.
    expect(cache.get("KEY", 100)).toBeUndefined();

    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("should keep an entry available forever when the TTL is disabled (0)", () => {
    const cache = new SimulationCache(2, 0);
    cache.set("KEY", "value", 0);

    expect(cache.get("KEY", 1_000_000)?.value).toBe("value");

    expect(cache.size).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(0);
  });

  it("should evict the least-recently-used entry when inserting beyond capacity", () => {
    const cache = new SimulationCache(2, 0);
    cache.set("A", "a", 0);
    cache.set("B", "b", 0);

    cache.set("C", "c", 0);

    expect(cache.get("A", 0)).toBeUndefined();
    expect(cache.get("B", 0)?.value).toBe("b");
    expect(cache.get("C", 0)?.value).toBe("c");
    expect(cache.evictions).toBe(1);
  });

  it("should refresh the LRU order on access so a newer read survives eviction", () => {
    const cache = new SimulationCache(2, 0);
    cache.set("A", "a", 0);
    cache.set("B", "b", 0);

    // Reading A makes it the most recently used entry.
    expect(cache.get("A", 10)?.value).toBe("a");

    cache.set("C", "c", 20);

    // B is now the least-recently-used entry and gets evicted instead of A.
    expect(cache.get("B", 20)).toBeUndefined();
    expect(cache.get("A", 20)?.value).toBe("a");
    expect(cache.get("C", 20)?.value).toBe("c");
  });

  it("should evict only the least-recently-used entry from a larger cache", () => {
    const cache = new SimulationCache(3, 0);
    cache.set("A", "a", 0);
    cache.set("B", "b", 1);
    cache.set("C", "c", 2);

    cache.get("A", 3);

    cache.set("D", "d", 4);

    expect(cache.get("B", 4)).toBeUndefined();
    expect(cache.get("A", 4)?.value).toBe("a");
    expect(cache.get("C", 4)?.value).toBe("c");
    expect(cache.get("D", 4)?.value).toBe("d");
    expect(cache.evictions).toBe(1);
  });

  it("should track hit, miss, and eviction counters", () => {
    const cache = new SimulationCache(1, 0);
    cache.set("A", "a", 0);

    expect(cache.get("A", 0)?.value).toBe("a");
    expect(cache.get("A", 1)?.value).toBe("a");
    expect(cache.get("missing", 1)).toBeUndefined();

    expect(cache.hits).toBe(2);
    expect(cache.misses).toBe(1);

    // Inserting B evicts the only resident entry (A).
    cache.set("B", "b", 2);

    expect(cache.evictions).toBe(1);
    expect(cache.get("B", 2)?.value).toBe("b");
    expect(cache.hits).toBe(3);
  });

  it("should clear all entries and reset the counters", () => {
    const cache = new SimulationCache(1, 0);
    cache.set("A", "a", 0);
    cache.get("A", 0);
    cache.set("B", "b", 1);
    cache.get("missing", 2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
    expect(cache.evictions).toBe(0);
  });
});
