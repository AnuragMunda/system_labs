import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppSelector } from "@/store/hooks";
import editorReducer from "@/store/editorSlice";
import simulationsReducer, {
  createSimulation,
  refreshSimulationStatus,
} from "@/store/simulationsSlice";
import {
  deleteSimulationApi,
  saveSimulationApi,
  type CreateSimulationInput,
  type SimulationDetails,
} from "@/lib/api/simulations";
import { TelemetryDrawer } from "./TelemetryBar";

vi.mock("@/lib/api/simulations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/simulations")>();
  return {
    ...actual,
    saveSimulationApi: vi.fn(),
    deleteSimulationApi: vi.fn(),
  };
});

const INPUT: CreateSimulationInput = {
  architectureId: "arch-1",
  sourceNodeId: "src",
  config: { durationMs: 60000, requestsPerSecond: 100 },
};

function makeDetails(
  overrides: Partial<SimulationDetails> = {},
): SimulationDetails {
  return {
    id: "sim-1",
    architectureId: "arch-1",
    status: "created",
    seed: 1,
    currentTimeMs: 0,
    sourceNodeId: "src",
    config: INPUT.config,
    snapshot: null,
    startedAt: null,
    completedAt: null,
    error: null,
    savedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function ConnectedDrawer({
  onRemoved,
}: {
  onRemoved: () => void;
}) {
  const run = useAppSelector((state) => state.simulations.runs["sim-1"]);
  return <TelemetryDrawer run={run} onRemoved={onRemoved} />;
}

function setup(details = makeDetails({ status: "running" })) {
  const store = configureStore({
    reducer: {
      editor: editorReducer,
      simulations: simulationsReducer,
    },
  });
  store.dispatch(createSimulation.fulfilled(details, "seed", INPUT));
  const onRemoved = vi.fn();

  render(
    <Provider store={store}>
      <ConnectedDrawer onRemoved={onRemoved} />
    </Provider>,
  );

  return { store, onRemoved };
}

beforeEach(() => {
  vi.mocked(saveSimulationApi).mockReset();
  vi.mocked(deleteSimulationApi).mockReset();
});

describe("TelemetryDrawer", () => {
  it("auto-opens when the active run transitions to completed", () => {
    const { store } = setup();

    expect(
      screen.queryByRole("region", { name: /simulation details/i }),
    ).not.toBeInTheDocument();

    act(() => {
      store.dispatch(
        refreshSimulationStatus.fulfilled(
          {
            id: "sim-1",
            status: "completed",
            currentTimeMs: 60000,
            durationMs: 60000,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            error: null,
          },
          "poll",
          "sim-1",
        ),
      );
    });

    expect(
      screen.getByRole("region", { name: /simulation details/i }),
    ).toBeInTheDocument();
  });

  it("does not reopen after the user collapses it", async () => {
    const { store } = setup();

    act(() => {
      store.dispatch(
        refreshSimulationStatus.fulfilled(
          {
            id: "sim-1",
            status: "completed",
            currentTimeMs: 60000,
            durationMs: 60000,
            startedAt: "t0",
            completedAt: "t1",
            error: null,
          },
          "poll",
          "sim-1",
        ),
      );
    });

    await userEvent.click(
      screen.getByRole("button", { name: /collapse details/i }),
    );
    expect(
      screen.queryByRole("region", { name: /simulation details/i }),
    ).not.toBeInTheDocument();

    act(() => {
      store.dispatch(
        refreshSimulationStatus.fulfilled(
          {
            id: "sim-1",
            status: "completed",
            currentTimeMs: 60000,
            durationMs: 60000,
            startedAt: "t0",
            completedAt: "t1",
            error: null,
          },
          "poll-2",
          "sim-1",
        ),
      );
    });

    expect(
      screen.queryByRole("region", { name: /simulation details/i }),
    ).not.toBeInTheDocument();
  });

  it("saves a completed draft and then offers removal", async () => {
    const { store } = setup(makeDetails({ status: "completed" }));
    vi.mocked(saveSimulationApi).mockResolvedValue(
      makeDetails({
        status: "completed",
        savedAt: "2026-01-02T00:00:00.000Z",
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /toggle simulation details/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save simulation/i }),
    );

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
    expect(store.getState().simulations.runs["sim-1"].savedAt).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("confirms before permanently removing a saved run", async () => {
    const { store, onRemoved } = setup(
      makeDetails({
        status: "completed",
        savedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    vi.mocked(deleteSimulationApi).mockResolvedValue(
      makeDetails({ status: "completed", savedAt: "2026-01-02T00:00:00.000Z" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /toggle simulation details/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(screen.getByText(/remove permanently/i)).toBeInTheDocument();
    expect(deleteSimulationApi).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: /remove run/i }),
    );

    expect(deleteSimulationApi).toHaveBeenCalledWith("sim-1");
    expect(onRemoved).toHaveBeenCalledTimes(1);
    expect(store.getState().simulations.runs["sim-1"]).toBeUndefined();
  });

  it("offers neither save nor remove for an unsaved in-flight run", async () => {
    setup();

    await userEvent.click(
      screen.getByRole("button", { name: /toggle simulation details/i }),
    );

    expect(
      screen.queryByRole("button", { name: /save simulation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^remove$/i }),
    ).not.toBeInTheDocument();
  });
});
