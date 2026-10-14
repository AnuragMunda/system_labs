/**
 * @author Anurag Munda
 *
 * @file app.ts
 * @description Application instance responsible for defining routes, middlewares, and application logic.
 */

import express, { type Response } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import cookieParser from "cookie-parser";

import { logger } from "./lib/logger.js";
import router from "./routes/index.js";
import { errorMiddleware } from "./middlewares/errorMiddleware.js";
import { notFoundMiddleware } from "./middlewares/notFoundMiddleware.js";
import { env } from "./config/env.js";

const app = express();
const httpLogger = pinoHttp({ logger });

// Middlewares
app.use(express.json());
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);
app.use(httpLogger);
app.use(cookieParser());

// Version:1 Routes
app.use("/api/v1", router);

// Default routes
app.get("/", (_, res: Response) => {
  res.status(200).json({ message: "Welcome to the System Lab API!" });
});

app.get("/health", (_, res: Response) => {
  res.status(200).json({ status: "OK", message: "Server is healthy." });
});

// Unknown routes receive a JSON 404 instead of Express's default HTML response.
app.use(notFoundMiddleware);

/// Global Error Handler
app.use(errorMiddleware);

export default app;
