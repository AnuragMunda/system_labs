import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import authReducer from "@/store/authSlice";
import projectsReducer from "@/store/projectsSlice";
import editorReducer, { initEditor } from "@/store/editorSlice";
import simulationsReducer from "@/store/simulationsSlice";
import { buildNodeData } from "@/features/editor/serialize";
import type { EditorEdge, EditorNode } from "@/features/editor/types";
import { SimulationConfigDialog } from "./SimulationConfigDialog";

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      projects: projectsReducer,
      editor: editorReducer,
      simulations: simulationsReducer,
    },
  });
}

const clientNode: EditorNode = {
  id: "client-1",
  type: "component",
  position: { x: 0, y: 0 },
  data: { ...buildNodeData("client"), label: "Client" },
};

const apiNode: EditorNode = {
  id: "api-1",
  type: "component",
  position: { x: 120, y: 0 },
  data: { ...buildNodeData("api"), label: "API" },
};

const edge: EditorEdge = {
  id: "e1",
  source: "client-1",
  target: "api-1",
  type: "connection",
  data: { protocol: "http", trafficRate: 10, latencyMs: 5 },
};

function setup(onSubmit = vi.fn()) {
  const store = makeStore();
  store.dispatch(
    initEditor({
      architectureId: "arch-1",
      projectId: "proj-1",
      name: "Test",
      description: null,
      nodes: [clientNode, apiNode],
      edges: [edge],
    }),
  );

  render(
    <Provider store={store}>
      <SimulationConfigDialog
        open
        submitting={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    </Provider>,
  );
  return { onSubmit };
}

describe("SimulationConfigDialog create flow", () => {
  it("renders defaults and derives the client as traffic source", () => {
    setup();
    expect(screen.getByRole("dialog", { name: /run simulation/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toHaveValue(60);
    expect(screen.getByLabelText(/requests/i)).toHaveValue(100);
    const source = screen.getByLabelText(/traffic source/i) as HTMLSelectElement;
    expect(source.value).toBe("client-1");
  });

  it("submits the configured duration, rps and source", async () => {
    const { onSubmit } = setup();

    await userEvent.clear(screen.getByLabelText(/duration/i));
    await userEvent.type(screen.getByLabelText(/duration/i), "30");
    await userEvent.clear(screen.getByLabelText(/requests/i));
    await userEvent.type(screen.getByLabelText(/requests/i), "250");

    await userEvent.click(screen.getByRole("button", { name: /save & run/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const { sourceNodeId, config } = onSubmit.mock.calls[0][0];
    expect(sourceNodeId).toBe("client-1");
    expect(config.durationMs).toBe(30000);
    expect(config.requestsPerSecond).toBe(250);
    expect(config.collectMetrics).toBe(true);
    expect(config.emitEvents).toBe(true);
  });

  it("rejects a non-integer seed without submitting", async () => {
    const { onSubmit } = setup();

    await userEvent.type(screen.getByLabelText(/random seed/i), "1.5");
    await userEvent.click(screen.getByRole("button", { name: /save & run/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/whole number/i);
  });

  it("lets the user override the traffic source", async () => {
    const { onSubmit } = setup();

    await userEvent.selectOptions(
      screen.getByLabelText(/traffic source/i),
      "api-1",
    );
    await userEvent.click(screen.getByRole("button", { name: /save & run/i }));

    expect(onSubmit.mock.calls[0][0].sourceNodeId).toBe("api-1");
  });
});
