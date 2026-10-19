// Mock/seed data for the Project Overview workspace. The backend only persists
// Projects + Architectures, so every domain below (health metrics, per-architecture
// simulation results, comparisons, recent simulations/experiments/activity) is seeded
// here. Real architecture identity + component counts come from the API and are merged
// in via `buildArchitectureCards`. Mirrors the existing `data/dashboard-data.ts` approach.
import type { Health } from "@/lib/health";
import type { BackendArchitecture } from "@/lib/api/architectures";
import { formatRelativeTime } from "@/lib/utils";

// ----- View models ---------------------------------------------------------

// A single architecture as rendered in the Overview's ARCHITECTURES grid.
// `componentCount` is real (graph.nodes.length); the rest is seeded/derived.
export interface ArchitectureOverviewCard {
  id: string;
  name: string;
  description: string;
  componentCount: number;
  health: Health;
  latestSimulation: string;
  p95: string;
  errorRate?: string;
  cost?: string;
  version: string;
  lastModified: string;
  simulations: number;
}

// Project-wide health headline numbers (architectures count is supplied real).
export interface ProjectHealthOverview {
  architectures: number;
  simulations: number;
  experiments: number;
  activeIncidents: number;
  overallStatus: "operational" | "degraded" | "incident";
}

// A completed experiment comparing two architectures.
export interface OverviewExperiment {
  name: string;
  architecturesCompared: string;
  status: "completed" | "running";
}

// A single activity-feed entry.
export interface ActivityEntry {
  actor: string;
  action: string;
  target: string;
  timestamp: string;
}

// ----- Seeds ---------------------------------------------------------------

// Per-architecture simulation enrichment, keyed by lowercased name so the
// E-Commerce demo renders exactly as specced. Unknown names fall back below.
interface ArchitectureEnrichment {
  health: Health;
  latestSimulation: string;
  p95: string;
  errorRate?: string;
  cost?: string;
  version: string;
  lastModified: string;
  simulations: number;
}

const ARCHITECTURE_ENRICHMENT_SEED: Record<string, ArchitectureEnrichment> = {
  "production": {
    health: "healthy",
    latestSimulation: "Black Friday Test",
    p95: "124ms",
    errorRate: "0.4%",
    version: "v12",
    lastModified: "10 minutes ago",
    simulations: 42,
  },
  "high availability": {
    health: "healthy",
    latestSimulation: "Regional Failure",
    p95: "182ms",
    errorRate: "0.7%",
    version: "v7",
    lastModified: "1 hour ago",
    simulations: 18,
  },
  "event driven": {
    health: "degraded",
    latestSimulation: "50K RPS",
    p95: "241ms",
    errorRate: "1.8%",
    version: "v4",
    lastModified: "2 hours ago",
    simulations: 12,
  },
  "cost optimized": {
    health: "healthy",
    latestSimulation: "Traffic Spike",
    p95: "312ms",
    cost: "$284/mo",
    version: "v3",
    lastModified: "3 hours ago",
    simulations: 9,
  },
};

// Project health defaults (architectures count is injected from the API).
export const PROJECT_HEALTH_DEFAULTS: Omit<ProjectHealthOverview, "architectures"> = {
  simulations: 38,
  experiments: 6,
  activeIncidents: 1,
  overallStatus: "operational",
};

// Default comparison pair shown in the ARCHITECTURE COMPARISON section.
export const COMPARISON_DEFAULTS = {
  left: "Production",
  right: "High Availability",
  p95: ["124ms", "182ms"],
  availability: ["99.7%", "99.99%"],
  cost: ["$620", "$910"],
};

export const RECENT_EXPERIMENTS: OverviewExperiment[] = [
  { name: "Redis vs No Redis", architecturesCompared: "Production vs Cost Optimized", status: "completed" },
  { name: "Event Driven vs REST", architecturesCompared: "Production vs Event Driven", status: "completed" },
];

export const RECENT_ACTIVITY: ActivityEntry[] = [
  { actor: "Anurag", action: "modified", target: "Production", timestamp: "10 minutes ago" },
  { actor: "Rahul", action: "created", target: "High Availability", timestamp: "1 hour ago" },
  { actor: "Simulation", action: "completed on", target: "Event Driven", timestamp: "2 hours ago" },
];

// ----- Mappers -------------------------------------------------------------

// Deterministic fallback enrichment for architectures not present in the seed,
// so any project renders plausible cards. Real `updatedAt` drives lastModified.
function fallbackEnrichment(arch: BackendArchitecture): ArchitectureEnrichment {
  const healths: Health[] = ["healthy", "degraded", "healthy", "healthy"];
  const idx = arch.id.length % healths.length;
  return {
    health: healths[idx],
    latestSimulation: "Baseline Run",
    p95: `${80 + (arch.id.length % 200)}ms`,
    errorRate: `${(0.2 + (arch.id.length % 15) / 10).toFixed(1)}%`,
    version: "v1",
    lastModified: formatRelativeTime(arch.updatedAt) || "just now",
    simulations: (arch.id.length % 40) + 5,
  };
}

// Merges real architectures with seeded/derived enrichment into view models.
export function buildArchitectureCards(
  architectures: BackendArchitecture[],
): ArchitectureOverviewCard[] {
  return architectures.map((arch) => {
    const seed =
      ARCHITECTURE_ENRICHMENT_SEED[arch.name.toLowerCase()] ??
      fallbackEnrichment(arch);
    return {
      id: arch.id,
      name: arch.name,
      description: arch.description ?? "",
      componentCount: arch.graph.nodes.length,
      health: seed.health,
      latestSimulation: seed.latestSimulation,
      p95: seed.p95,
      errorRate: seed.errorRate,
      cost: seed.cost,
      version: seed.version,
      lastModified: seed.lastModified,
      simulations: seed.simulations,
    };
  });
}
