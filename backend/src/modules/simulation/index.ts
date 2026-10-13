/**
 * @file index.ts
 *
 * @description Wires the simulation module's dependencies together (manual DI).
 * The orchestrator has no infrastructure dependencies, so a single instance is
 * exported for controllers to import.
 */

import { SimulationOrchestrator } from "./simulation.orchestrator.js";

export const simulationOrchestrator = new SimulationOrchestrator();

export { SimulationOrchestrator } from "./simulation.orchestrator.js";
export type {
  CreateSimulationInput,
  SimulationReport,
  SimulationSnapshot,
  SimulationStepResult,
} from "./simulation.orchestrator.types.js";
