import { describe, expect, it } from "vitest";

import type { BackendArchitectureNode } from "@/lib/api/architectures";
import {
  buildNodeData,
  createNode,
  deserializeNode,
  serializeNode,
} from "./serialize";

describe("routingStrategy serialization", () => {
  it("defaults to round_robin in node data", () => {
    expect(buildNodeData("api").routingStrategy).toBe("round_robin");
  });

  it("round-trips routingStrategy through serialize/deserialize", () => {
    const node = createNode("api", { x: 10, y: 20 }, "Gateway");
    node.data.routingStrategy = "least_connections";

    const wire = serializeNode(node);
    expect(wire.config.routingStrategy).toBe("least_connections");

    const back = deserializeNode(wire);
    expect(back.data.routingStrategy).toBe("least_connections");
  });

  it("falls back to round_robin for an invalid stored value", () => {
    const stored: BackendArchitectureNode = {
      id: "n1",
      type: "api",
      name: "API",
      position: { x: 0, y: 0 },
      config: { routingStrategy: "bogus" },
    };
    expect(deserializeNode(stored).data.routingStrategy).toBe("round_robin");
  });
});

describe("node serialization round-trip", () => {
  it("preserves identity, position and core config", () => {
    const node = createNode("cache", { x: 3.6, y: 7.2 }, "Redis");
    const wire = serializeNode(node);

    expect(wire.id).toBe(node.id);
    expect(wire.type).toBe("cache");
    expect(wire.name).toBe("Redis");
    expect(wire.position).toEqual({ x: 4, y: 7 });

    const back = deserializeNode(wire);
    expect(back.id).toBe(node.id);
    expect(back.data.kind).toBe("cache");
    expect(back.data.label).toBe("Redis");
    expect(back.data.replicas).toBe(node.data.replicas);
    expect(back.data.region).toBe(node.data.region);
  });
});
