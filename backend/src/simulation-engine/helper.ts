/**
 * @file helper.ts
 *
 * @description Pure helper functions consumed by the simulation engine's event
 * processor and component logic.
 */

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

export const DEFAULT_RETRY_DELAY_MS = 10;

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
