import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SimulationControls } from "./SimulationControls";
import type { SimulationRunState } from "@/store/simulationsSlice";

function makeRun(
  status: SimulationRunState["status"],
  overrides: Partial<SimulationRunState> = {},
): SimulationRunState {
  return {
    id: "sim-1",
    architectureId: "arch-1",
    status,
    currentTimeMs: 0,
    durationMs: 60000,
    startedAt: null,
    completedAt: null,
    error: null,
    results: null,
    liveMetrics: null,
    pending: false,
    actionError: null,
    ...overrides,
  };
}

describe("SimulationControls", () => {
  it("shows a Run button when there is no run", async () => {
    const onStart = vi.fn();
    render(
      <SimulationControls
        submitting={false}
        onStart={onStart}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /run simulation/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("shows Start for a created run and Cancel alongside", () => {
    render(
      <SimulationControls
        run={makeRun("created")}
        submitting={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeEnabled();
  });

  it("shows Pause while running and Resume while paused", () => {
    const { rerender } = render(
      <SimulationControls
        run={makeRun("running")}
        submitting={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeEnabled();

    rerender(
      <SimulationControls
        run={makeRun("paused")}
        submitting={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeEnabled();
  });

  it("falls back to Run for a terminal status", () => {
    render(
      <SimulationControls
        run={makeRun("completed")}
        submitting={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /run simulation/i })).toBeEnabled();
  });

  it("disables action buttons while the run is pending", () => {
    render(
      <SimulationControls
        run={makeRun("running", { pending: true })}
        submitting={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
