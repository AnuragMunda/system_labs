/**
 * @file types.ts
 *
 * @description Shared type definitions for the simulation engine.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";

export interface EventProcessor {
  process(event: SimulationEvent): void;
}