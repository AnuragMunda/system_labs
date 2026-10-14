/**
 * @file simulation-recovery.ts
 *
 * @description Startup reconciliation for simulations. In-memory engine state
 * is never restored, so any run left `running` or `paused` by a previous
 * process (crash, redeploy, or restart) can never make progress. Rather than
 * leaving it stuck forever, each such run is transitioned to `failed` with an
 * explanatory reason so clients observing status/results get a definitive
 * answer.
 *
 * This is intentionally process-local: it assumes a single API instance owns
 * the simulations. Leases/heartbeats for multi-process ownership are deferred.
 */

import { logger } from "@/lib/logger.js";
import { SimulationRepository } from "@/modules/simulation/simulation.repository.js";

/** Reason recorded on runs abandoned by a previous process. */
export const RECOVERY_REASON =
  "interrupted: server restarted before completion";

/**
 * Marks every in-flight simulation as failed and logs how many were
 * reconciled. Returns the reconciled rows so callers/tests can observe them.
 */
export async function recoverInterruptedSimulations(
  repository: SimulationRepository = new SimulationRepository(),
): Promise<Awaited<ReturnType<SimulationRepository["failInterrupted"]>>> {
  const reconciled = await repository.failInterrupted(RECOVERY_REASON);

  if (reconciled.length > 0) {
    logger.warn(
      { count: reconciled.length, ids: reconciled.map((row) => row.id) },
      "Reconciled interrupted simulations to failed",
    );
  }

  return reconciled;
}
