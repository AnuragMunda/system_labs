import type { SimulationMetrics } from "@/lib/api/simulations";
import { componentHealthToHealth } from "./mapping";
import { HEALTH_STYLES } from "@/lib/health";

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

export function SimulationMetricsPanel({
  metrics,
  labels = {},
}: {
  metrics: SimulationMetrics;
  labels?: Record<string, string>;
}) {
  const seconds = metrics.processedDurationMs / 1000;
  const throughput = seconds > 0 ? metrics.requests.completed / seconds : 0;
  const { requests, failures, latency, network } = metrics;
  const components = Object.values(metrics.components);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Throughput" value={`${Math.round(throughput)} req/s`} />
        <Stat label="Completed" value={formatNumber(requests.completed)} />
        <Stat label="Failed" value={formatNumber(requests.failed)} />
        <Stat
          label="Error rate"
          value={`${(requests.errorRate * 100).toFixed(2)}%`}
        />
        <Stat label="P50" value={`${Math.round(latency.endToEnd.p50Ms)}ms`} />
        <Stat label="P95" value={`${Math.round(latency.endToEnd.p95Ms)}ms`} />
        <Stat label="P99" value={`${Math.round(latency.endToEnd.p99Ms)}ms`} />
        <Stat
          label="Packet loss"
          value={`${(network.packetLossRate * 100).toFixed(2)}%`}
        />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Components
        </h3>
        {components.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No per-component metrics were recorded.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Component</th>
                  <th className="px-3 py-2 font-medium">Processed</th>
                  <th className="px-3 py-2 font-medium">P95</th>
                  <th className="px-3 py-2 font-medium">Failed</th>
                  <th className="px-3 py-2 font-medium">Peak queue</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {components.map((component) => {
                  const health = componentHealthToHealth(
                    component.health.state,
                  );
                  const styles = HEALTH_STYLES[health];
                  return (
                    <tr
                      key={component.nodeId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-foreground">
                        {labels[component.nodeId] ?? component.nodeId}
                      </td>
                      <td className="px-3 py-2 font-mono text-foreground">
                        {formatNumber(component.traffic.processed)}
                      </td>
                      <td className="px-3 py-2 font-mono text-foreground">
                        {Math.round(component.latency.p95Ms)}ms
                      </td>
                      <td className="px-3 py-2 font-mono text-foreground">
                        {formatNumber(component.traffic.failedAttempts)}
                      </td>
                      <td className="px-3 py-2 font-mono text-foreground">
                        {formatNumber(component.queue.peakDepth)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`flex items-center gap-1.5 text-xs ${styles.value}`}
                        >
                          <span
                            className={`size-2 rounded-full ${styles.dot}`}
                          />
                          {styles.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {failures.total > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Failures by reason
          </h3>
          <ul className="flex flex-col gap-1">
            {Object.entries(failures.byReason).map(([reason, count]) => (
              <li
                key={reason}
                className="flex items-center justify-between rounded-sm border border-border bg-muted/30 px-3 py-1.5 text-sm"
              >
                <span className="text-foreground">{reason}</span>
                <span className="font-mono text-muted-foreground">
                  {formatNumber(count)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
