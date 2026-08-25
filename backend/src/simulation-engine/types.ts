/**
 * @file types.ts
 *
 * @description Shared type definitions for the simulation engine.
 */

import { SimulationEvent } from "@/domain/simulation/event.types.js";

/** Callback the engine invokes for each event at its simulated timestamp. */
export type EventProcessor = (event: SimulationEvent) => void;
