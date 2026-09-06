/**
 * @file simulation-random.ts
 *
 * @description A deterministic pseudo-random number generator (PRNG) based on
 * the Mulberry32 algorithm. Given the same seed, the generator produces the
 * exact same sequence of numbers, which is essential for reproducible
 * simulation runs. The generator advances a 32-bit internal state and returns
 * a floating-point value in the range [0, 1).
 */

/**
 * Deterministic PRNG for simulations that require reproducible randomness.
 *
 * Each instance maintains its own 32-bit state derived from the seed. Two
 * instances constructed with the same seed will produce identical sequences.
 * The algorithm is Mulberry32 — fast, non-cryptographic, and suitable for
 * simulation workloads where statistical quality is less important than
 * determinism and speed.
 */
export class SimulationRandom {
  /** Internal 32-bit state; each call to {@link next} mutates this value. */
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0; // Ensure the seed is a 32-bit unsigned integer
  }

  /**
   * Returns the next pseudo-random number in the range [0, 1).
   *
   * The method advances the internal state using a sequence of additions,
   * multiplications, and XOR operations (Mulberry32 mixing steps) and
   * normalises the result to a floating-point value. The sequence is fully
   * deterministic for a given seed.
   *
   * @returns A number `n` such that `0 <= n < 1`.
   */
  next(): number {
    let t = (this.state + 0x6d2b79f5) | 0;

    this.state = t;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
