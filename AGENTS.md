# AGENTS.md - Interactive System Design Simulator

## Project Overview

Interactive System Design Simulator is a full-stack platform for designing and simulating distributed systems visually.

Users can:

* Build architectures using visual components and connections.
* Configure traffic, latency, bandwidth, failures, queues, caches, databases, etc.
* Run deterministic simulations against architecture snapshots.
* Inspect events, metrics, bottlenecks, failures, and system behavior.
* Save and manage projects, architectures, simulations, and scenarios.

## Architecture

* Backend: Modular monolith for the MVP.
* Simulation execution: Separate simulation worker process.
* Frontend and backend are independent applications.
* **Do NOT use a monorepo.**
* PostgreSQL is the primary persistent database.
* Redis/BullMQ are used for asynchronous jobs where required.
* WebSockets are used for real-time simulation/editor communication.

## Hard Constraints

1. Do not introduce microservices for the MVP.
2. Do not convert the project into a monorepo.
3. Do not bypass the existing module boundaries.
4. Do not put business logic in controllers/routes.
5. Do not access the database directly from controllers.
6. Validate external input with Zod.
7. Authentication/authorization must be enforced server-side.
8. Never trust ownership IDs supplied by clients; derive them from authenticated identity.
9. Never expose passwords, password hashes, refresh-token hashes, or secrets.
10. Simulations must operate on an architecture snapshot, not a mutable live architecture.
11. Preserve deterministic simulation behavior when a seed is provided.
12. Complete one task at a time; do not make unrelated changes.
13. Do not add dependencies without a clear requirement.
14. Run relevant lint/typecheck/tests after changes.

## Project Structure

```text
interactive-system-design-simulator/
├── backend/       # Express API + simulation infrastructure
├── frontend/      # Next.js application
├── AGENTS.md      # This file
└── README.md
```

## Agent Entry Points

* Backend rules: `backend/AGENTS.md`
* Frontend rules: `frontend/AGENTS.md`

Before modifying code, read this file and the relevant application-level `AGENTS.md`.
