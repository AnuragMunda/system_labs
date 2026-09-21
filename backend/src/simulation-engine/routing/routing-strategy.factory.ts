import { RoutingStrategyType } from "@/domain/architecture/component.types.js";
import { LeastConnectionsStrategy } from "./least-connections-strategy.js";
import { RandomStrategy } from "./random-strategy.js";
import { RoundRobinStrategy } from "./round-robin-strategy.js";
import type { RoutingStrategy } from "../utils/types.js";

/** Maps a {@link RoutingStrategyType} string to its concrete implementation. */
export function createRoutingStrategy(
  strategyType: RoutingStrategyType = "round_robin",
): RoutingStrategy {
  switch (strategyType) {
    case "round_robin":
      return new RoundRobinStrategy();

    case "random":
      return new RandomStrategy();

    case "least_connections":
      return new LeastConnectionsStrategy();

    default:
      throw new Error(`Unsupported routing strategy: ${strategyType}`);
  }
}
