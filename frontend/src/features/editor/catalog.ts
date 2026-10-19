// The component palette catalog: every draggable component, its category, icon,
// default configuration, and an illustrative per-replica hourly cost used for the
// estimated-cost readouts. Icons are named lucide-react imports.
import {
  Boxes,
  Cog,
  CreditCard,
  Database,
  DoorOpen,
  Globe,
  HardDrive,
  Leaf,
  ListOrdered,
  MemoryStick,
  MessageSquare,
  Plug,
  Scale,
  Server,
  Share2,
  ShieldCheck,
  Shuffle,
  User,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type {
  AutoscalingConfig,
  ComponentCategory,
  ComponentKind,
  EditorNodeData,
  RetryPolicy,
} from "./types";

export interface CatalogItem {
  kind: ComponentKind;
  label: string;
  category: ComponentCategory;
  icon: LucideIcon;
  /** Illustrative $/hour per replica (used for cost estimates). */
  costPerReplicaPerHour: number;
  defaults: Partial<EditorNodeData>;
}

export const CATEGORY_ORDER: ComponentCategory[] = [
  "infrastructure",
  "compute",
  "data",
  "messaging",
  "external",
];

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  infrastructure: "Infrastructure",
  compute: "Compute",
  data: "Data",
  messaging: "Messaging",
  external: "External",
};

const BASE_AUTOSCALING: AutoscalingConfig = {
  enabled: false,
  min: 1,
  max: 10,
  targetCpu: 70,
};

const BASE_RETRY: RetryPolicy = { retries: 3, circuitBreaker: true };

function defaults(overrides: Partial<EditorNodeData>): Partial<EditorNodeData> {
  return {
    replicas: 2,
    cpu: 2,
    memory: 4,
    autoscaling: BASE_AUTOSCALING,
    region: "us-east-1",
    timeoutMs: 500,
    retryPolicy: BASE_RETRY,
    routingStrategy: "round_robin",
    traffic: 0,
    latencyMs: 20,
    capacity: 1000,
    concurrency: 200,
    errorRate: 0.001,
    ...overrides,
  };
}

export const COMPONENT_CATALOG: CatalogItem[] = [
  // Infrastructure
  {
    kind: "load_balancer",
    label: "Load Balancer",
    category: "infrastructure",
    icon: Scale,
    costPerReplicaPerHour: 0.025,
    defaults: defaults({ replicas: 2, latencyMs: 5 }),
  },
  {
    kind: "api_gateway",
    label: "API Gateway",
    category: "infrastructure",
    icon: DoorOpen,
    costPerReplicaPerHour: 0.012,
    defaults: defaults({ replicas: 3, latencyMs: 8 }),
  },
  {
    kind: "cdn",
    label: "CDN",
    category: "infrastructure",
    icon: Globe,
    costPerReplicaPerHour: 0.01,
    defaults: defaults({ replicas: 1, latencyMs: 2 }),
  },
  {
    kind: "reverse_proxy",
    label: "Reverse Proxy",
    category: "infrastructure",
    icon: Shuffle,
    costPerReplicaPerHour: 0.01,
    defaults: defaults({ replicas: 2, latencyMs: 4 }),
  },

  // Compute
  {
    kind: "api",
    label: "Service",
    category: "compute",
    icon: Boxes,
    costPerReplicaPerHour: 0.02,
    defaults: defaults({ replicas: 3, latencyMs: 25, cpu: 2 }),
  },
  {
    kind: "worker",
    label: "Worker",
    category: "compute",
    icon: Cog,
    costPerReplicaPerHour: 0.02,
    defaults: defaults({ replicas: 3, latencyMs: 15, traffic: 0 }),
  },
  {
    kind: "server",
    label: "Server",
    category: "compute",
    icon: Server,
    costPerReplicaPerHour: 0.05,
    defaults: defaults({ replicas: 1, cpu: 4, memory: 16, latencyMs: 18 }),
  },
  {
    kind: "serverless_function",
    label: "Serverless Function",
    category: "compute",
    icon: Zap,
    costPerReplicaPerHour: 0.0005,
    defaults: defaults({ replicas: 1, cpu: 1, memory: 1, latencyMs: 30 }),
  },

  // Data
  {
    kind: "postgresql",
    label: "PostgreSQL",
    category: "data",
    icon: Database,
    costPerReplicaPerHour: 0.1,
    defaults: defaults({ replicas: 3, cpu: 4, memory: 16, latencyMs: 12 }),
  },
  {
    kind: "mysql",
    label: "MySQL",
    category: "data",
    icon: Database,
    costPerReplicaPerHour: 0.09,
    defaults: defaults({ replicas: 3, cpu: 4, memory: 16, latencyMs: 12 }),
  },
  {
    kind: "mongodb",
    label: "MongoDB",
    category: "data",
    icon: Leaf,
    costPerReplicaPerHour: 0.1,
    defaults: defaults({ replicas: 3, cpu: 4, memory: 16, latencyMs: 14 }),
  },
  {
    kind: "redis",
    label: "Redis",
    category: "data",
    icon: MemoryStick,
    costPerReplicaPerHour: 0.034,
    defaults: defaults({ replicas: 3, cpu: 2, memory: 8, latencyMs: 2 }),
  },
  {
    kind: "object_storage",
    label: "Object Storage",
    category: "data",
    icon: HardDrive,
    costPerReplicaPerHour: 0.023,
    defaults: defaults({ replicas: 1, cpu: 1, memory: 4, latencyMs: 8 }),
  },

  // Messaging
  {
    kind: "kafka",
    label: "Kafka",
    category: "messaging",
    icon: Workflow,
    costPerReplicaPerHour: 0.06,
    defaults: defaults({ replicas: 3, cpu: 4, memory: 16, latencyMs: 6 }),
  },
  {
    kind: "rabbitmq",
    label: "RabbitMQ",
    category: "messaging",
    icon: MessageSquare,
    costPerReplicaPerHour: 0.04,
    defaults: defaults({ replicas: 2, cpu: 2, memory: 8, latencyMs: 5 }),
  },
  {
    kind: "queue",
    label: "Queue",
    category: "messaging",
    icon: ListOrdered,
    costPerReplicaPerHour: 0.015,
    defaults: defaults({ replicas: 2, cpu: 2, memory: 4, latencyMs: 4 }),
  },
  {
    kind: "event_bus",
    label: "Event Bus",
    category: "messaging",
    icon: Share2,
    costPerReplicaPerHour: 0.03,
    defaults: defaults({ replicas: 2, cpu: 2, memory: 4, latencyMs: 7 }),
  },

  // External
  {
    kind: "external_api",
    label: "External API",
    category: "external",
    icon: Plug,
    costPerReplicaPerHour: 0,
    defaults: defaults({ replicas: 1, cpu: 0, memory: 0, latencyMs: 120 }),
  },
  {
    kind: "payment_provider",
    label: "Payment Provider",
    category: "external",
    icon: CreditCard,
    costPerReplicaPerHour: 0,
    defaults: defaults({ replicas: 1, cpu: 0, memory: 0, latencyMs: 200 }),
  },
  {
    kind: "auth_provider",
    label: "Authentication Provider",
    category: "external",
    icon: ShieldCheck,
    costPerReplicaPerHour: 0,
    defaults: defaults({ replicas: 1, cpu: 0, memory: 0, latencyMs: 90 }),
  },
];

/** Virtual entry-point node (not in the palette) used to seed client traffic. */
export const CLIENT_ITEM: CatalogItem = {
  kind: "client",
  label: "Client",
  category: "external",
  icon: User,
  costPerReplicaPerHour: 0,
  defaults: defaults({ replicas: 1, cpu: 0, memory: 0, latencyMs: 0, traffic: 5000 }),
};

/** Palette items: the component catalog plus the virtual client entry point. */
export const PALETTE_CATALOG: CatalogItem[] = [...COMPONENT_CATALOG, CLIENT_ITEM];

const BY_KIND = new Map<ComponentKind, CatalogItem>(
  [...COMPONENT_CATALOG, CLIENT_ITEM].map((item) => [item.kind, item]),
);

export function getCatalogItem(kind: ComponentKind): CatalogItem | undefined {
  return BY_KIND.get(kind);
}

export function getCatalogIcon(kind: ComponentKind): LucideIcon {
  return BY_KIND.get(kind)?.icon ?? Boxes;
}

export function getCatalogLabel(kind: ComponentKind): string {
  return BY_KIND.get(kind)?.label ?? kind;
}

export const HOURS_PER_MONTH = 730;

/** Estimated monthly cost for a single node given its replica count. */
export function nodeMonthlyCost(kind: ComponentKind, replicas: number): number {
  const item = BY_KIND.get(kind);
  if (!item) return 0;
  return item.costPerReplicaPerHour * Math.max(1, replicas) * HOURS_PER_MONTH;
}
