/**
 * @file simulation-recovery.test.ts
 *
 * @description Unit tests for the startup simulation-recovery helper. The
 * repository is mocked so the test asserts the reconciliation reason and the
 * returned rows without a database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  RECOVERY_REASON,
  recoverInterruptedSimulations,
} from "../../../src/jobs/simulation-recovery.js";
import { SimulationRepository } from "../../../src/modules/simulation/simulation.repository.js";

type SimulationRow = Awaited<ReturnType<SimulationRepository["findById"]>>;

const repo = {
  failInterrupted: vi.fn(),
} as unknown as SimulationRepository;

const reconciled = [
  { id: "a", status: "failed", error: RECOVERY_REASON },
  { id: "b", status: "failed", error: RECOVERY_REASON },
] as unknown as SimulationRow[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recoverInterruptedSimulations", () => {
  it("marks in-flight runs as failed with the recovery reason", async () => {
    vi.mocked(repo.failInterrupted).mockResolvedValue(reconciled);

    const result = await recoverInterruptedSimulations(repo);

    expect(repo.failInterrupted).toHaveBeenCalledWith(RECOVERY_REASON);
    expect(result).toBe(reconciled);
  });

  it("is a no-op when nothing was in flight", async () => {
    vi.mocked(repo.failInterrupted).mockResolvedValue([]);

    await expect(recoverInterruptedSimulations(repo)).resolves.toEqual([]);
  });
});
