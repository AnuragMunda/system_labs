import { describe, expect, it, vi } from "vitest";
import { RandomStrategy } from "@/simulation-engine/routing/random-strategy.js";
import { ArchitectureEdge } from "@/domain/architecture/connection.types.js";
import { SimulationRandom } from "@/simulation-engine/random/simulation-random.js";
import { RoutingContext } from "@/simulation-engine/routing/routing-context.js";

describe("RandomStrategy", () => {
  const edges: ArchitectureEdge[] = [
    {
      id: "edge-1",
      source: "gateway",
      target: "api-1",
      config: {},
    },
    {
      id: "edge-2",
      source: "gateway",
      target: "api-2",
      config: {},
    },
    {
      id: "edge-3",
      source: "gateway",
      target: "api-3",
      config: {},
    },
  ];

  function makeContext(random: SimulationRandom): RoutingContext {
    return {
      sourceNodeId: "gateway",
      requestId: "request-1",
      random,
      getActiveRequestCount: () => 0,
    };
  }

  it("selects the edge derived from the supplied random value", () => {
    const random = new SimulationRandom(42);
    const nextSpy = vi.spyOn(random, "next").mockReturnValueOnce(0.4);

    const strategy = new RandomStrategy();

    // floor(0.4 * 3) = 1 → edge-2.
    expect(strategy.selectEdge(edges, makeContext(random)).id).toBe("edge-2");

    // A single draw drives the selection.
    expect(nextSpy).toHaveBeenCalledTimes(1);
  });

  it("maps the random value to the edge index", () => {
    const strategy = new RandomStrategy();

    const firstRandom = new SimulationRandom(42);
    vi.spyOn(firstRandom, "next").mockReturnValueOnce(0.0);

    expect(strategy.selectEdge(edges, makeContext(firstRandom)).id).toBe(
      "edge-1",
    );

    const lastRandom = new SimulationRandom(42);
    vi.spyOn(lastRandom, "next").mockReturnValueOnce(0.9);

    expect(strategy.selectEdge(edges, makeContext(lastRandom)).id).toBe(
      "edge-3",
    );
  });

  it("is fully deterministic for a given seed", () => {
    const strategy = new RandomStrategy();

    const firstEdge = strategy.selectEdge(
      edges,
      makeContext(new SimulationRandom(12345)),
    ).id;

    const secondEdge = strategy.selectEdge(
      edges,
      makeContext(new SimulationRandom(12345)),
    ).id;

    expect(firstEdge).toBe(secondEdge);
  });

  it("throws when no outgoing edges exist", () => {
    const strategy = new RandomStrategy();

    expect(() =>
      strategy.selectEdge([], makeContext(new SimulationRandom(42))),
    ).toThrow("No outgoing edges available for node gateway.");
  });
});
