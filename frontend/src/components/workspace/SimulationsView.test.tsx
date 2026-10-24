import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceContext } from "./workspace-context";
import { SimulationsView } from "./SimulationsView";
import { useSimulationList } from "@/features/simulations/useSimulationList";
import {
  deleteSimulationApi,
  type SimulationDetails,
  type SimulationSummary,
} from "@/lib/api/simulations";
import type { BackendArchitecture } from "@/lib/api/architectures";

vi.mock("@/features/simulations/useSimulationList", () => ({
  useSimulationList: vi.fn(),
}));

vi.mock("@/lib/api/simulations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/simulations")>();
  return {
    ...actual,
    deleteSimulationApi: vi.fn(),
  };
});

const architecture: BackendArchitecture = {
  id: "arch-1",
  projectId: "proj-1",
  name: "Payments",
  description: null,
  graph: { nodes: [], edges: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function makeSummary(
  overrides: Partial<SimulationSummary> = {},
): SimulationSummary {
  return {
    id: "sim-1",
    architectureId: "arch-1",
    status: "completed",
    currentTimeMs: 60000,
    durationMs: 60000,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    error: null,
    savedAt: "2026-01-01T00:01:00.000Z",
    seed: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setup(sim = makeSummary()) {
  const reload = vi.fn();
  vi.mocked(useSimulationList).mockReturnValue({
    items: [sim],
    total: 1,
    loading: false,
    error: null,
    reload,
  });

  render(
    <WorkspaceContext.Provider
      value={{
        projectId: "proj-1",
        project: null,
        architectures: [architecture],
        reload: vi.fn(),
      }}
    >
      <SimulationsView />
    </WorkspaceContext.Provider>,
  );

  return { reload };
}

beforeEach(() => {
  vi.mocked(useSimulationList).mockReset();
  vi.mocked(deleteSimulationApi).mockReset();
});

describe("SimulationsView delete flow", () => {
  it("confirms, deletes, reloads, and closes the dialog", async () => {
    vi.mocked(deleteSimulationApi).mockResolvedValue({} as SimulationDetails);
    const { reload } = setup();

    await userEvent.click(
      screen.getByRole("button", { name: /delete simulation for payments/i }),
    );

    const dialog = screen.getByRole("dialog", { name: /delete simulation/i });
    expect(dialog).toHaveTextContent(/events and metrics/i);
    expect(dialog).toHaveTextContent(/completed/i);

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(deleteSimulationApi).toHaveBeenCalledWith("sim-1"),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("dialog", { name: /delete simulation/i }),
    ).not.toBeInTheDocument();
  });

  it("does not delete when canceled", async () => {
    setup();

    await userEvent.click(
      screen.getByRole("button", { name: /delete simulation for payments/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(deleteSimulationApi).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: /delete simulation/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the error when deletion fails", async () => {
    vi.mocked(deleteSimulationApi).mockRejectedValue(
      new Error("Cannot delete an active simulation"),
    );
    const { reload } = setup();

    await userEvent.click(
      screen.getByRole("button", { name: /delete simulation for payments/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("Cannot delete an active simulation");
    expect(
      screen.getByRole("dialog", { name: /delete simulation/i }),
    ).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not offer delete for an active simulation", () => {
    setup(makeSummary({ status: "running" }));

    expect(
      screen.queryByRole("button", { name: /delete simulation/i }),
    ).not.toBeInTheDocument();
  });
});
