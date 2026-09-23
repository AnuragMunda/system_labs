/**
 * @file cache-handling.ts
 *
 * @description Handlers for the cache events emitted after a request is routed
 * to a cache component: `cache.hit`, `cache.miss`, and `cache.set`.
 *
 * A hit completes the request immediately (the cache fast path). A miss sends
 * the request into the cache's normal capacity-bound processing, remembering
 * on the request itself that it is on the miss path so the context survives
 * retries and queue admission. When a miss completes, the value is stored via
 * `cache.set` and the request completes at the cache.
 */

import type { SimulationEvent } from "@/domain/simulation/event.types.js";

import { SimulationRuntime } from "../../core/simulation-runtime.js";
import { createEvent } from "../../utils/helpers.js";
import { getRequestId } from "./event-handling.js";

/** Handlers for the `cache.*` event types. */
export class CacheHandlers {
  constructor(private readonly runtime: SimulationRuntime) {}

  /**
   * Sends a request that missed the cache into the cache's normal processing
   * path.
   *
   * The request is marked with `cacheMiss` so every later transition (retry,
   * queue drain) continues to know it is on the miss path and will eventually
   * populate the cache on completion.
   */
  handleCacheMiss(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error("cache.miss event requires a sourceNodeId.");
    }

    const cacheKey = event.payload?.cacheKey;

    if (typeof cacheKey !== "string") {
      throw new Error("cache.miss event requires a cacheKey.");
    }

    this.runtime.updateRequest(requestId, {
      cacheMiss: true,
    });

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.processing_started",
        sourceNodeId: event.sourceNodeId,
        targetNodeId: event.sourceNodeId,
        payload: {
          requestId,
          cacheKey,
          cacheMiss: true,
        },
      }),
    );
  }

  /**
   * Completes a request that hit the cache without consuming any processing
   * capacity: a hit is the cheap fast path, so it bypasses capacity, latency,
   * and processing-based health evaluation entirely.
   */
  handleCacheHit(event: SimulationEvent): void {
    const requestId = getRequestId(event);

    if (!event.sourceNodeId) {
      throw new Error("cache.hit event requires a sourceNodeId.");
    }

    const cacheKey = event.payload?.cacheKey;

    if (typeof cacheKey !== "string") {
      throw new Error("cache.hit event requires a cacheKey.");
    }

    this.runtime.getRequest(requestId);

    this.runtime.updateRequest(requestId, {
      currentNodeId: event.sourceNodeId,
    });

    this.runtime.schedule(
      createEvent({
        simulationId: event.simulationId,
        timestampMs: event.timestampMs,
        type: "request.completed",
        sourceNodeId: event.sourceNodeId,
        payload: {
          requestId,
          cacheKey,
          cacheHit: true,
        },
      }),
    );
  }

  /**
   * Stores a value in a cache after a miss completes. The stored value is the
   * "backend response" represented by the request that populated the entry.
   */
  handleCacheSet(event: SimulationEvent): void {
    if (!event.sourceNodeId) {
      throw new Error("cache.set event requires a sourceNodeId.");
    }

    const cacheKey = event.payload?.cacheKey;

    if (typeof cacheKey !== "string") {
      throw new Error("cache.set event requires a cacheKey.");
    }

    this.runtime.setCacheEntry(
      event.sourceNodeId,
      cacheKey,
      event.payload?.value ?? null,
    );
  }
}
