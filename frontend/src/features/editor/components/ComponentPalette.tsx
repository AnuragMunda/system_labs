"use client";

// Left component palette: a search box plus the categorized, draggable component
// list. Each item is HTML5-draggable (sets the component kind on the data transfer)
// so the canvas can drop it at the cursor; clicking also adds it at a default spot.
import { useMemo, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";

import { useAppDispatch } from "@/store/hooks";
import { addNode } from "@/store/editorSlice";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  PALETTE_CATALOG,
  getCatalogIcon,
} from "../catalog";
import { CLICK_DROP_POSITION, DND_MIME, type ComponentKind } from "../constants";
import type { ComponentCategory } from "../types";

export function ComponentPalette({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PALETTE_CATALOG.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q) ||
        c.kind.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    );
    return CATEGORY_ORDER.map((cat: ComponentCategory) => ({
      category: cat,
      items: filtered.filter((c) => c.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Open components panel"
        className="flex w-9 shrink-0 flex-col items-center justify-center gap-2 border-r border-border bg-card text-primary transition-colors hover:bg-muted"
      >
        <PanelLeftOpen className="size-4" aria-hidden="true" />
        <span className="text-[15px] uppercase tracking-wider [writing-mode:vertical-rl]">
          Components
        </span>
      </button>
    );
  }

  function onDragStart(e: React.DragEvent, kind: ComponentKind) {
    e.dataTransfer.setData(DND_MIME, kind);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Components
          </h2>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse components panel"
            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelLeftClose className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components…"
            aria-label="Search components"
            className="h-9 w-full rounded-sm border border-border bg-muted pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus-visible:border-border-strong"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {grouped.map((group) => (
          <div key={group.category} className="mb-3">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[group.category]}
            </p>
            <div className="flex flex-col gap-1">
              {group.items.map((item) => {
                const Icon = getCatalogIcon(item.kind);
                return (
                  <button
                    key={item.kind}
                    type="button"
                    draggable
                    onDragStart={(e) => onDragStart(e, item.kind)}
                    onClick={() =>
                      dispatch(addNode({ kind: item.kind, position: CLICK_DROP_POSITION }))
                    }
                    className="group flex cursor-grab items-center gap-2 rounded-sm border border-border bg-background px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:border-border-strong hover:bg-muted active:cursor-grabbing"
                  >
                    <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {grouped.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            No components match.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
