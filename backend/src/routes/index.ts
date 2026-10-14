/**
 * @file index.ts
 *
 * @description Root API router. Collects every module router and mounts it
 * under its base path; the app serves this router at `/api/v1`.
 */

import architectureRouter from "@/modules/architecture/architecture.routes.js";
import authRouter from "@/modules/auth/auth.routes.js";
import projectRouter from "@/modules/project/project.routes.js";
import simulationRouter from "@/modules/simulation/simulation.routes.js";
import { Router } from "express";

const router = Router();

router.use("/architectures", architectureRouter);
router.use("/auth", authRouter);
router.use("/projects", projectRouter);
router.use("/simulations", simulationRouter);

export default router;
