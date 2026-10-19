import type { SimulationStatus } from "@/lib/api/simulations";
import { statusLabel, statusTone, type StatusTone } from "./mapping";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-border text-muted-foreground",
  active: "border-primary/40 bg-primary/10 text-primary",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-accent/40 bg-accent/10 text-accent",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

export function SimulationStatusPill({
  status,
}: {
  status: SimulationStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[statusTone(status)]}`}
    >
      {statusLabel(status)}
    </span>
  );
}
