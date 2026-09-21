/**
 * @file helpers.ts
 *
 * @description Pure helper functions shared across the simulation engine: error
 * rate checks, retry policy, concurrency math, network latency resolution, and
 * event construction.
 */

import { randomUUID } from "node:crypto";

import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import { SimulationEvent } from "@/domain/simulation/event.types.js";

import { DEFAULT_NETWORK_LATENCY_MS } from "./constants.js";

// ---------------------------------------------------------------------------
// Error Rate
// ---------------------------------------------------------------------------

/**
 * Determines whether a component-level failure should trigger based on the
 * configured error rate and a random value from the simulation's PRNG.
 *
 * @param errorRate - Probability of failure, must be in the range [0, 1].
 *   A value of 0 means failures never occur; a value of 1 means they always
 *   occur (for any valid random value).
 * @param randomValue - A pseudo-random number in [0, 1) from
 *   `SimulationRandom.next()`.
 * @returns `true` when `randomValue < errorRate`, signalling a failure.
 * @throws {Error} If `errorRate` is outside [0, 1] or `randomValue` is
 *   outside [0, 1).
 */
export function shouldFail(errorRate: number, randomValue: number): boolean {
  if (errorRate < 0 || errorRate > 1) {
    throw new Error(
      `Error rate must be between 0 and 1. Received: ${errorRate}.`,
    );
  }

  // Guaranteed success.
  if (errorRate === 0) {
    return false;
  }

  // Guaranteed failure.
  if (errorRate === 1) {
    return true;
  }

  if (randomValue < 0 || randomValue >= 1) {
    throw new Error(
      `Random value must be between 0 and 1. Received: ${randomValue}.`,
    );
  }

  return randomValue < errorRate;
}

// ---------------------------------------------------------------------------
// Retry Policy
// ---------------------------------------------------------------------------

/**
 * Determines whether a retry is allowed given the current attempt number and
 * the configured maximum number of retries.
 *
 * @param attempts - The current attempt number (1-based). Represents the total
 *   number of times the request has been attempted so far.
 * @param maxRetries - The maximum number of retries allowed after the first
 *   failure. A value of 0 means no retries; the request must succeed on the
 *   first attempt.
 * @returns `true` when `attempts <= maxRetries`.
 * @throws {Error} If `attempts` is less than 1 or `maxRetries` is negative.
 */
export function canRetry(attempts: number, maxRetries: number): boolean {
  if (attempts < 1) {
    throw new Error("Attempts must be at least 1.");
  }

  if (maxRetries < 0) {
    throw new Error("Max retries cannot be negative.");
  }

  return attempts <= maxRetries;
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

/**
 * Calculates the effective concurrency for a node based on its replica count
 * and per-replica concurrency setting. This represents the maximum number of
 * requests that can be processed concurrently by the node.
 *
 * @param replicas - Number of replicas; must be a positive integer.
 * @param concurrency - Concurrency per replica; must be a positive integer.
 * @returns The product of `replicas` and `concurrency`.
 * @throws {Error} If `replicas` or `concurrency` are not positive integers.
 */
export function getEffectiveConcurrency(
  replicas: number,
  concurrency: number,
): number {
  if (!Number.isInteger(replicas) || replicas < 1) {
    throw new Error("Replicas must be a positive integer.");
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer.");
  }

  return replicas * concurrency;
}

// ---------------------------------------------------------------------------
// Network Latency
// ---------------------------------------------------------------------------

/**
 * Resolves the network latency of a single architecture connection (edge). The
 * value is read from the edge's configuration and validated before being
 * applied during event routing.
 */
export function getNetworkLatency(edge: ArchitectureEdge): number {
  const latencyMs = edge.config.latencyMs;

  // Default latency is used for connections without an explicit value.
  if (latencyMs === undefined) {
    return DEFAULT_NETWORK_LATENCY_MS;
  }

  // A negative latency would move a request backwards in time.
  if (latencyMs < 0) {
    throw new Error(
      `Connection ${edge.id} has an invalid latency: ${latencyMs}ms.`,
    );
  }

  return latencyMs;
}

// ---------------------------------------------------------------------------
// Event Construction
// ---------------------------------------------------------------------------

/** Produces a unique event id. */
export function newEventId(): string {
  return randomUUID();
}

/** Input for {@link createEvent} with an optional explicit id. */
export type CreateEventInput = Omit<SimulationEvent, "id"> & { id?: string };

/**
 * Builds a simulation event, generating a unique id when one is not supplied.
 * An explicit `id` can be passed for deterministic event ids (for example
 * pre-generated request load).
 */
export function createEvent(input: CreateEventInput): SimulationEvent {
  return {
    ...input,
    id: input.id ?? newEventId(),
  };
}
