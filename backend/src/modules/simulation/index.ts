/**
 * @file index.ts
 *
 * @description Wires the simulation module's dependencies together (manual DI):
 * the orchestrator has no infrastructure dependencies and is owned by the
 * execution manager, while the HTTP service receives the simulation,
 * architecture, and project repositories so it can enforce
 * ownership/visibility before scheduling a run. Controllers import the
 * ready-to-use singleton service from here; the server imports the execution
 * manager for shutdown.
 */

import { SimulationExecutionManager } from "./simulation.execution.js";
import { SimulationOrchestrator } from "./simulation.orchestrator.js";
import { SimulationRepository } from "./simulation.repository.js";
import { SimulationService } from "./simulation.service.js";
import { ArchitectureRepository } from "../architecture/architecture.repository.js";
import { ProjectRepository } from "../project/project.repository.js";

export const simulationOrchestrator = new SimulationOrchestrator();

const repository = new SimulationRepository();
const architectureRepository = new ArchitectureRepository();
const projectRepository = new ProjectRepository();

export const simulationExecutionManager = new SimulationExecutionManager(
  repository,
  simulationOrchestrator,
);

export const simulationService = new SimulationService(
  repository,
  architectureRepository,
  projectRepository,
  simulationExecutionManager,
);

export { SimulationExecutionManager } from "./simulation.execution.js";
export { SimulationOrchestrator } from "./simulation.orchestrator.js";
export { SimulationRepository } from "./simulation.repository.js";
export type {
  CreateSimulationInput,
  SimulationReport,
  SimulationSnapshot,
  SimulationStepResult,
} from "./simulation.orchestrator.types.js";
