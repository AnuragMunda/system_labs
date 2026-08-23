/**
 * @file architecture.types.ts
 *
 * @description An architecture represents the structure of a software system, including its components (nodes) and the connections (edges) between them.
 * It is associated with a specific project and contains metadata.
 */

import { ArchitectureNode } from "./component.types.js";
import { ArchitectureEdge } from "./connection.types.js";

export interface Architecture {
  id: string;
  projectId: string;

  name: string;
  description?: string | null;

  graph: ArchitectureGraph;

  createdAt: Date;
  updatedAt: Date;
}

export interface ArchitectureGraph {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}
