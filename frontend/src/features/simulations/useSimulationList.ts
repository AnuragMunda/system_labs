"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  listSimulationsApi,
  type ListSimulationsParams,
  type SimulationSummary,
} from "@/lib/api/simulations";
import { isActiveStatus } from "./mapping";

const POLL_INTERVAL_MS = 1000;

export interface SimulationListResult {
  items: SimulationSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSimulationList(
  params: ListSimulationsParams,
  active = true,
): SimulationListResult {
  const [items, setItems] = useState<SimulationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function load() {
      try {
        const page = await listSimulationsApi(params);
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.pagination.total);
        setError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(
          e instanceof Error ? e.message : "Failed to load simulations",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [active, params, version]);

  const hasActive = useMemo(
    () => items.some((item) => isActiveStatus(item.status)),
    [items],
  );

  useEffect(() => {
    if (!active || !hasActive) return;
    const interval = window.setInterval(() => {
      setVersion((v) => v + 1);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [active, hasActive]);

  return { items, total, loading, error, reload };
}
