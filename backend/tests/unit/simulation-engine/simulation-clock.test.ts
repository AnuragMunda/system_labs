/**
 * @file simulation-clock.test.ts
 *
 * @description Unit tests for the monotonic virtual clock that drives the
 * discrete-event loop: forward advancement, rejection of backward and invalid
 * (non-finite) advancement, and the rewind used for replay.
 */

import { describe, expect, it } from "vitest";

import { SimulationClock } from "@/simulation-engine/core/simulation-clock.js";

describe("SimulationClock", () => {
  it("starts at zero", () => {
    expect(new SimulationClock().now()).toBe(0);
  });

  it("advances to a later timestamp", () => {
    const clock = new SimulationClock();

    clock.advanceTo(120);

    expect(clock.now()).toBe(120);
  });

  it("allows advancing to the current timestamp", () => {
    const clock = new SimulationClock();

    clock.advanceTo(50);
    clock.advanceTo(50);

    expect(clock.now()).toBe(50);
  });

  it("rejects a negative timestamp and leaves the time unchanged", () => {
    const clock = new SimulationClock();

    clock.advanceTo(50);

    expect(() => clock.advanceTo(-1)).toThrow(
      "Simulation time cannot be negative.",
    );
    expect(clock.now()).toBe(50);
  });

  it("rejects a negative timestamp from zero", () => {
    expect(() => new SimulationClock().advanceTo(-0.5)).toThrow(
      "Simulation time cannot be negative.",
    );
  });

  it("rejects a backward advancement and leaves the time unchanged", () => {
    const clock = new SimulationClock();

    clock.advanceTo(50);

    expect(() => clock.advanceTo(49)).toThrow(
      "Timestamp must be greater than current time.",
    );
    expect(clock.now()).toBe(50);
  });

  it("rejects NaN and leaves the time unchanged", () => {
    const clock = new SimulationClock();

    clock.advanceTo(50);

    expect(() => clock.advanceTo(Number.NaN)).toThrow(
      "Simulation time must be a finite number.",
    );
    expect(clock.now()).toBe(50);
  });

  it("rejects infinite and leaves the time unchanged", () => {
    const clock = new SimulationClock();

    clock.advanceTo(50);

    expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow(
      "Simulation time must be a finite number.",
    );
    expect(clock.now()).toBe(50);
  });

  it("reset rewinds the clock to zero for a fresh run", () => {
    const clock = new SimulationClock();

    clock.advanceTo(500);
    clock.reset();

    expect(clock.now()).toBe(0);

    clock.advanceTo(100);

    expect(clock.now()).toBe(100);
  });
});
