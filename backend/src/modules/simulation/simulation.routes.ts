/**
 * @file simulation.routes.ts
 *
 * @description Express router mounting the simulation module's endpoints.
 * Reads (details/status/results) inherit the parent project's visibility and so
 * use `authenticateOptional`; create and lifecycle controls require an
 * authenticated user and are additionally checked for ownership in the service.
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
  getSimulationById,
  getSimulationResults,
  getSimulationStatus,
  pauseSimulation,
  resumeSimulation,
  startSimulation,
} from "./simulation.controller.js";
import { createSimulationSchema } from "./simulation.schema.js";

const simulationRouter: Router = Router();

simulationRouter
  .route("/")
  .post(authenticate, validate(createSimulationSchema), createSimulation);

simulationRouter.route("/:id").get(authenticateOptional, getSimulationById);

simulationRouter
  .route("/:id/status")
  .get(authenticateOptional, getSimulationStatus);

simulationRouter
  .route("/:id/results")
  .get(authenticateOptional, getSimulationResults);

simulationRouter.route("/:id/start").post(authenticate, startSimulation);

simulationRouter.route("/:id/pause").post(authenticate, pauseSimulation);

simulationRouter.route("/:id/resume").post(authenticate, resumeSimulation);

simulationRouter.route("/:id/cancel").post(authenticate, cancelSimulation);

export default simulationRouter;
