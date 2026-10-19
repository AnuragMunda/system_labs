// Project workspace tab bar: Overview, Architectures, Simulations, Experiments,
// Scenarios, Metrics, Incidents, Cost, Versions, Team. Highlights the active tab
// from the pathname; every tab (except Overview) routes to a placeholder page.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The ordered tab labels and their routes (Overview is the workspace root).
const TABS: { label: string; href: string }[] = [
  { label: "Overview", href: "" },
  { label: "Architectures", href: "/architectures" },
  { label: "Simulations", href: "/simulations" },
  { label: "Experiments", href: "/experiments" },
  { label: "Scenarios", href: "/scenarios" },
  { label: "Metrics", href: "/metrics" },
  { label: "Incidents", href: "/incidents" },
  { label: "Cost", href: "/cost" },
  { label: "Versions", href: "/versions" },
  { label: "Team", href: "/team" },
];

// Renders the horizontal tab strip for a project workspace at `/projects/[id]`.
export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav
      aria-label="Project sections"
      className="flex gap-1 overflow-x-auto border-b border-border px-6"
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active =
          tab.href === ""
            ? pathname === base
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
