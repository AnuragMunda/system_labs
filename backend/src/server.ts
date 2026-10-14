/**
 * @author Anurag Munda
 *
 * @file server.ts
 * @description The underlying HTTP server instance created that handles incoming network requests, binds to a port, and manages the actual HTTP protocol.
 */

import type { Server } from "node:http";

import app from "./app.js";
import { env } from "./config/env.js";
import { recoverInterruptedSimulations } from "./jobs/simulation-recovery.js";
import { logger } from "./lib/logger.js";
import { simulationExecutionManager } from "./modules/simulation/index.js";

/** Boots the server: reconciles stale runs, then begins listening. */
async function bootstrap(): Promise<void> {
  await recoverInterruptedSimulations();

  const server = app.listen(env.PORT, () => {
    console.log(
      `Server is running on port ${env.PORT} in ${env.NODE_ENV} mode.`,
    );
  });

  registerShutdown(server);
}

/**
 * Wires graceful shutdown: stop accepting connections, interrupt any in-flight
 * simulations (persisting them as failed), then exit. Registered once.
 */
function registerShutdown(server: Server): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    server.close();
    await simulationExecutionManager.shutdown();

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
