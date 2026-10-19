import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

import {
  cancelSimulationApi,
  createSimulationApi,
  getSimulationResultsApi,
  getSimulationStatusApi,
  pauseSimulationApi,
  resumeSimulationApi,
  startSimulationApi,
  type CreateSimulationInput,
  type SimulationDetails,
  type SimulationMetrics,
  type SimulationStatus,
} from "@/lib/api/simulations";

export interface SimulationRunState {
  id: string;
  architectureId: string;
  status: SimulationStatus;
  currentTimeMs: number;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  results: SimulationMetrics | null;
  pending: boolean;
  actionError: string | null;
}

interface SimulationsState {
  runs: Record<string, SimulationRunState>;
  latestByArchitecture: Record<string, string>;
  submitting: boolean;
  createError: string | null;
}

const initialState: SimulationsState = {
  runs: {},
  latestByArchitecture: {},
  submitting: false,
  createError: null,
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

function emptyRun(id: string, architectureId: string): SimulationRunState {
  return {
    id,
    architectureId,
    status: "created",
    currentTimeMs: 0,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    error: null,
    results: null,
    pending: false,
    actionError: null,
  };
}

function fromDetails(details: SimulationDetails): SimulationRunState {
  return {
    id: details.id,
    architectureId: details.architectureId,
    status: details.status,
    currentTimeMs: details.currentTimeMs,
    durationMs: details.config?.durationMs ?? null,
    startedAt: details.startedAt,
    completedAt: details.completedAt,
    error: details.error,
    results: null,
    pending: false,
    actionError: null,
  };
}

function applyDetails(state: SimulationsState, details: SimulationDetails): void {
  const existing = state.runs[details.id];
  const next = fromDetails(details);
  next.results = existing?.results ?? null;
  state.runs[details.id] = next;
}

function beginRunAction(state: SimulationsState, id: string): void {
  const run = state.runs[id];
  if (!run) return;
  run.pending = true;
  run.actionError = null;
}

function failRunAction(
  state: SimulationsState,
  id: string,
  message: string | undefined,
): void {
  const run = state.runs[id];
  if (!run) return;
  run.pending = false;
  run.actionError = message ?? "Action failed";
}

export const createSimulation = createAsyncThunk(
  "simulations/create",
  async (input: CreateSimulationInput, { rejectWithValue }) => {
    try {
      return await createSimulationApi(input);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const startSimulation = createAsyncThunk(
  "simulations/start",
  async (id: string, { rejectWithValue }) => {
    try {
      return await startSimulationApi(id);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const pauseSimulation = createAsyncThunk(
  "simulations/pause",
  async (id: string, { rejectWithValue }) => {
    try {
      return await pauseSimulationApi(id);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const resumeSimulation = createAsyncThunk(
  "simulations/resume",
  async (id: string, { rejectWithValue }) => {
    try {
      return await resumeSimulationApi(id);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const cancelSimulation = createAsyncThunk(
  "simulations/cancel",
  async (id: string, { rejectWithValue }) => {
    try {
      return await cancelSimulationApi(id);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const refreshSimulationStatus = createAsyncThunk(
  "simulations/refreshStatus",
  async (id: string, { rejectWithValue }) => {
    try {
      return await getSimulationStatusApi(id);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const fetchSimulationResults = createAsyncThunk(
  "simulations/fetchResults",
  async (id: string, { rejectWithValue }) => {
    try {
      return await getSimulationResultsApi(id);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

const simulationsSlice = createSlice({
  name: "simulations",
  initialState,
  reducers: {
    clearCreateError(state) {
      state.createError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(createSimulation.pending, (state) => {
        state.submitting = true;
        state.createError = null;
      })
      .addCase(createSimulation.fulfilled, (state, action) => {
        state.submitting = false;
        const run = fromDetails(action.payload);
        state.runs[run.id] = run;
        state.latestByArchitecture[run.architectureId] = run.id;
      })
      .addCase(createSimulation.rejected, (state, action) => {
        state.submitting = false;
        state.createError =
          (action.payload as string | undefined) ??
          action.error.message ??
          "Failed to create simulation";
      })
      .addCase(startSimulation.pending, (state, action) =>
        beginRunAction(state, action.meta.arg),
      )
      .addCase(startSimulation.fulfilled, (state, action) =>
        applyDetails(state, action.payload),
      )
      .addCase(startSimulation.rejected, (state, action) =>
        failRunAction(
          state,
          action.meta.arg,
          action.payload as string | undefined,
        ),
      )
      .addCase(pauseSimulation.pending, (state, action) =>
        beginRunAction(state, action.meta.arg),
      )
      .addCase(pauseSimulation.fulfilled, (state, action) =>
        applyDetails(state, action.payload),
      )
      .addCase(pauseSimulation.rejected, (state, action) =>
        failRunAction(
          state,
          action.meta.arg,
          action.payload as string | undefined,
        ),
      )
      .addCase(resumeSimulation.pending, (state, action) =>
        beginRunAction(state, action.meta.arg),
      )
      .addCase(resumeSimulation.fulfilled, (state, action) =>
        applyDetails(state, action.payload),
      )
      .addCase(resumeSimulation.rejected, (state, action) =>
        failRunAction(
          state,
          action.meta.arg,
          action.payload as string | undefined,
        ),
      )
      .addCase(cancelSimulation.pending, (state, action) =>
        beginRunAction(state, action.meta.arg),
      )
      .addCase(cancelSimulation.fulfilled, (state, action) =>
        applyDetails(state, action.payload),
      )
      .addCase(cancelSimulation.rejected, (state, action) =>
        failRunAction(
          state,
          action.meta.arg,
          action.payload as string | undefined,
        ),
      )
      .addCase(refreshSimulationStatus.fulfilled, (state, action) => {
        const view = action.payload;
        const existing = state.runs[view.id] ?? emptyRun(view.id, "");
        state.runs[view.id] = {
          ...existing,
          status: view.status,
          currentTimeMs: view.currentTimeMs,
          durationMs: view.durationMs,
          startedAt: view.startedAt,
          completedAt: view.completedAt,
          error: view.error,
        };
      })
      .addCase(refreshSimulationStatus.rejected, (state, action) => {
        const run = state.runs[action.meta.arg];
        if (run) run.actionError = (action.payload as string | null) ?? null;
      })
      .addCase(fetchSimulationResults.fulfilled, (state, action) => {
        const { simulation, metrics } = action.payload;
        const existing =
          state.runs[simulation.id] ??
          emptyRun(simulation.id, simulation.architectureId);
        state.runs[simulation.id] = {
          ...existing,
          status: simulation.status,
          currentTimeMs: simulation.currentTimeMs,
          durationMs:
            simulation.config?.durationMs ?? existing.durationMs ?? null,
          startedAt: simulation.startedAt,
          completedAt: simulation.completedAt,
          error: simulation.error,
          results: metrics,
        };
      });
  },
});

export const { clearCreateError } = simulationsSlice.actions;
export default simulationsSlice.reducer;
