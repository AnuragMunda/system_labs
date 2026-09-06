/**
 * @file helper.ts
 *
 * @description Pure helper functions consumed by the simulation engine's event
 * processor and component logic. These are small, deterministic utilities that
 * decide simulation behaviour based on configuration values and the PRNG
 * output — they have no side-effects and no framework dependencies.
 */

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
