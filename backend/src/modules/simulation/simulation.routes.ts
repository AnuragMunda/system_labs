/**
 * @file simulation.routes.ts
 *
 * @description Express router mounting the simulation module's endpoints.
 * The list requires an authenticated owner (like the project/architecture
 * lists); single-run reads (details/status/metrics/results) inherit the parent
 * project's visibility and so use `authenticateOptional`; create and lifecycle
 * controls require an authenticated user and are additionally checked for
 * ownership in the service.
 */

import { Router } from "express";

import {
  authenticate,
  authenticateOptional,
} from "@/middlewares/authenticate.js";
import { validate } from "@/middlewares/validate.js";

import {
  cancelSimulation,
  createSimulation,
  deleteSimulation,
  getSimulationById,
  getSimulationMetrics,
  getSimulationResults,
  getSimulations,
  getSimulationStatus,
  pauseSimulation,
  resumeSimulation,
  saveSimulation,
  startSimulation,
} from "./simulation.controller.js";
import { createSimulationSchema } from "./simulation.schema.js";

const simulationRouter: Router = Router();

simulationRouter
  .route("/")
  .get(authenticate, getSimulations)
  .post(authenticate, validate(createSimulationSchema), createSimulation);

simulationRouter
  .route("/:id")
  .get(authenticateOptional, getSimulationById)
  .delete(authenticate, deleteSimulation);

simulationRouter
  .route("/:id/status")
  .get(authenticateOptional, getSimulationStatus);

simulationRouter
  .route("/:id/metrics")
  .get(authenticateOptional, getSimulationMetrics);

simulationRouter
  .route("/:id/results")
  .get(authenticateOptional, getSimulationResults);

simulationRouter.route("/:id/start").post(authenticate, startSimulation);

simulationRouter.route("/:id/pause").post(authenticate, pauseSimulation);

simulationRouter.route("/:id/resume").post(authenticate, resumeSimulation);

simulationRouter.route("/:id/cancel").post(authenticate, cancelSimulation);

simulationRouter.route("/:id/save").post(authenticate, saveSimulation);

export default simulationRouter;
