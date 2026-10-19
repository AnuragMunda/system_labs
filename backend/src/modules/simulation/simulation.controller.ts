/**
 * @file simulation.controller.ts
 *
 * @description HTTP handlers for the simulation module. Each handler validates
 * its path params with a Zod schema, delegates to the service, and sends a
 * standardized ApiResponse. Errors are thrown and handled by the global
 * middleware via asyncHandler.
 */

import { Request, Response } from "express";

import {
  ApiResponse,
  BadRequestError,
  UnauthorizedError,
  asyncHandler,
} from "@/lib/index.js";

import {
  idParamSchema,
  listSimulationsQuerySchema,
} from "./simulation.schema.js";
import { simulationService } from "./index.js";

/** Returns the authenticated user's identity or throws. */
const requireUser = (req: Request) => {
  if (!req.user) {
    throw UnauthorizedError();
  }

  return req.user;
};

/** Parses and validates the `:id` path param, throwing a 400 on failure. */
const requireId = (req: Request): string => {
  const params = idParamSchema.safeParse(req.params);

  if (!params.success) {
    throw BadRequestError(params.error.message);
  }

  return params.data.id;
};

/** POST /api/v1/simulations — creates a simulation (201). */
export const createSimulation = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);

    const simulation = await simulationService.create(user.id, req.body);

    return ApiResponse.created(
      res,
      simulation,
      "Simulation created successfully",
    );
  },
);

/** GET /api/v1/simulations — paginated list of the caller's simulations. */
export const getSimulations = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);

    const query = listSimulationsQuerySchema.safeParse(req.query);

    if (!query.success) {
      throw BadRequestError(query.error.message);
    }

    const result = await simulationService.getPaginated(user.id, query.data);

    return ApiResponse.ok(res, result);
  },
);

/** GET /api/v1/simulations/:id — fetches a simulation's details. */
export const getSimulationById = asyncHandler(
  async (req: Request, res: Response) => {
    const simulation = await simulationService.findById(
      requireId(req),
      req.user?.id,
    );

    return ApiResponse.ok(res, simulation);
  },
);

/** GET /api/v1/simulations/:id/status — fetches a simulation's lifecycle status. */
export const getSimulationStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const status = await simulationService.getStatus(
      requireId(req),
      req.user?.id,
    );

    return ApiResponse.ok(res, status);
  },
);

/**
 * GET /api/v1/simulations/:id/metrics — fetches the run's metrics at its
 * current virtual time while in-flight, or the persisted report once complete.
 * Clients poll this during an active run to drive the live canvas view.
 */
export const getSimulationMetrics = asyncHandler(
  async (req: Request, res: Response) => {
    const metrics = await simulationService.getMetrics(
      requireId(req),
      req.user?.id,
    );

    return ApiResponse.ok(res, metrics);
  },
);

/** GET /api/v1/simulations/:id/results — fetches a simulation's aggregate report. */
export const getSimulationResults = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await simulationService.getResults(
      requireId(req),
      req.user?.id,
    );

    return ApiResponse.ok(res, result);
  },
);

/**
 * POST /api/v1/simulations/:id/start — claims a simulation and schedules it to
 * run in the background, responding 202. Clients poll `/status` and `/results`.
 */
export const startSimulation = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);

    const simulation = await simulationService.start(requireId(req), user.id);

    return ApiResponse.accepted(
      res,
      simulation,
      "Simulation started successfully",
    );
  },
);

/** POST /api/v1/simulations/:id/pause — pauses a running simulation. */
export const pauseSimulation = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);

    const simulation = await simulationService.pause(requireId(req), user.id);

    return ApiResponse.ok(res, simulation, "Simulation paused successfully");
  },
);

/** POST /api/v1/simulations/:id/resume — resumes a paused simulation. */
export const resumeSimulation = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);

    const simulation = await simulationService.resume(requireId(req), user.id);

    return ApiResponse.ok(res, simulation, "Simulation resumed successfully");
  },
);

/** POST /api/v1/simulations/:id/cancel — cancels a simulation. */
export const cancelSimulation = asyncHandler(
  async (req: Request, res: Response) => {
    const user = requireUser(req);

    const simulation = await simulationService.cancel(requireId(req), user.id);

    return ApiResponse.ok(res, simulation, "Simulation cancelled successfully");
  },
);
