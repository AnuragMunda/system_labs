import { useEffect, useRef } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchSimulationMetrics,
  fetchSimulationResults,
  refreshSimulationStatus,
  type SimulationRunState,
} from "@/store/simulationsSlice";
import { isActiveStatus } from "./mapping";

const POLL_INTERVAL_MS = 1000;

/**
 * Keeps a single simulation run's status fresh by polling the backend while it is
 * active, and fetches the aggregate report once the run completes. Returns the
 * run from the simulations slice (undefined until it is first seeded).
 */
export function useSimulationRun(id: string | null): SimulationRunState | undefined {
  const dispatch = useAppDispatch();
  const run = useAppSelector((state) =>
    id ? state.simulations.runs[id] : undefined,
  );
  const status = run?.status;
  const resultsFetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    dispatch(refreshSimulationStatus(id));
  }, [id, dispatch]);

  useEffect(() => {
    if (!id || !status || !isActiveStatus(status)) return;
    const interval = window.setInterval(() => {
      dispatch(refreshSimulationStatus(id));
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [id, status, dispatch]);

  useEffect(() => {
    if (!id || status !== "running") return;
    dispatch(fetchSimulationMetrics(id));
    const interval = window.setInterval(() => {
      dispatch(fetchSimulationMetrics(id));
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [id, status, dispatch]);

  useEffect(() => {
    if (!id || status !== "completed") return;
    if (resultsFetchedFor.current === id) return;
    resultsFetchedFor.current = id;
    dispatch(fetchSimulationResults(id));
  }, [id, status, dispatch]);

  return run;
}
