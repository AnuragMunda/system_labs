import { SimulationRandom } from "@/simulation-engine/random/simulation-random.js";
import { describe, expect, it } from "vitest";

describe("SimulationRandom", () => {
  it("should produce deterministic output for a known seed", () => {
    const rng = new SimulationRandom(42);

    const values = Array.from({ length: 5 }, () => rng.next());

    expect(values).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
      0.6697340414393693, 0.17481389874592423,
    ]);
  });

  it("should produce the same sequence for the same seed", () => {
    const a = new SimulationRandom(7);
    const b = new SimulationRandom(7);

    const valuesA = Array.from({ length: 10 }, () => a.next());
    const valuesB = Array.from({ length: 10 }, () => b.next());

    expect(valuesA).toEqual(valuesB);
  });

  it("should produce different sequences for different seeds", () => {
    const a = new SimulationRandom(42);
    const b = new SimulationRandom(99);

    const valuesA = Array.from({ length: 5 }, () => a.next());
    const valuesB = Array.from({ length: 5 }, () => b.next());

    expect(valuesA).not.toEqual(valuesB);
  });

  it("should return values in the range [0, 1)", () => {
    const rng = new SimulationRandom(1);

    for (let i = 0; i < 1000; i++) {
      const value = rng.next();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("should coerce negative seeds to unsigned 32-bit integers", () => {
    const rng = new SimulationRandom(-1);

    expect(rng["state"]).toBe(4294967295);

    const value = rng.next();

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("should coerce fractional seeds to unsigned 32-bit integers", () => {
    const rng = new SimulationRandom(3.7);

    expect(rng["state"]).toBe(3);

    const value = rng.next();

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("should produce a long non-repeating sequence", () => {
    const rng = new SimulationRandom(1);
    const seen = new Set<number>();

    for (let i = 0; i < 1000; i++) {
      seen.add(rng.next());
    }

    expect(seen.size).toBe(1000);
  });
});
