# Backend Architecture

## Overview

The backend is a **modular monolith** built with Express and TypeScript.

```text
HTTP/API
   │
   ▼
Controllers
   │
   ▼
Services ───────────────► Domain
   │
   ▼
Repositories ──────────► Database
   │
   └────────────────────► Infrastructure

Simulation API
   │
   ▼
Simulation Queue
   │
   ▼
Simulation Worker
   │
   ▼
Simulation Session (prepares load/failures/autoscaling)
   │
   ▼
Simulation Engine
```

Modules should communicate through explicit service/domain interfaces rather than reaching into another module's internals.

---

## Module Boundaries

### Auth

**Responsibility**

- User registration and login.
- Access/refresh token lifecycle.
- Session management.
- Authentication and current-user operations.

**Interfaces**

- `AuthService`
- `UserRepository`
- `SessionRepository`
- JWT/cookie infrastructure.

**Dependencies**

- Domain: auth
- Infrastructure: database, JWT, cookies, password hashing
- Used by: middleware and protected modules

---

### Project

**Responsibility**

- Create, read, update, and delete projects.
- Project ownership and visibility.
- Provide the top-level resource boundary for architectures, simulations, and scenarios.

**Interfaces**

- `ProjectService`
- `ProjectRepository`

**Dependencies**

- Auth identity
- Project domain
- Database

---

### Architecture

**Responsibility**

- Create and manage system architectures.
- Manage architecture nodes/components and connections.
- Validate architecture structure.
- Provide immutable architecture snapshots for simulations.

**Interfaces**

- `ArchitectureService`
- `ArchitectureRepository`

**Dependencies**

- Project ownership
- Architecture domain
- Database

**Used by**

- Simulation module
- Scenario module
- Frontend architecture editor

---

### Scenario

**Responsibility**

- Define traffic patterns, failures, latency changes, and other simulation conditions.
- Validate and persist reusable simulation scenarios.

**Interfaces**

- `ScenarioService`
- `ScenarioRepository`

**Dependencies**

- Project
- Architecture domain
- Database

**Used by**

- Simulation module

---

### Simulation

**Responsibility**

- Create and manage simulation runs.
- Capture architecture snapshots.
- Validate simulation configuration.
- Submit simulation jobs.
- Track simulation lifecycle and results.

**Interfaces**

- `SimulationService`
- `SimulationRepository`
- `SimulationQueue`

**Dependencies**

- Architecture snapshot
- Scenario
- Database
- Redis/BullMQ
- Simulation Engine

**Important**
The Simulation module orchestrates execution; it does not contain the simulation engine's internal behavior.

---

## Simulation Engine

**Responsibility**

- Coordinate simulation execution: drive the runtime's event queue and clock
  through an event processor, which applies events to simulation state.
- Maintain simulation time.
- Schedule and process simulation events.
- Own no simulation state and no event semantics — those belong to the runtime
  and the event processor.

**Lifecycle**

- All status transitions flow through `SimulationLifecycle`, a single state
  machine that rejects invalid transitions instead of applying them silently.
- Valid transitions: `created → running`, `created → cancelled`,
  `running → paused/completed/failed/cancelled`, `paused → running/cancelled`.
- Terminal states (`completed`, `failed`, `cancelled`) never transition again;
  a `step()` whose event processing throws marks the simulation `failed`.
- The one exception is `reset`, a rewind (not a transition): it is allowed
  from every status, returns the simulation to `created`, and clears
  `completedAt` so `run → reset → run` replays the same inputs deterministically.

**State ownership & invariants**

- `SimulationRuntime` is the single source of truth: requests, components,
  per-component queues, caches, routing strategies, metrics, clock, event
  queue, and PRNG all live on the runtime. Event handlers and processors hold
  no mutable state of their own.
- `component.activeRequests` is incremented only on the processing-start path
  after every failure check has passed, and decremented only by the matching
  processing-completed event — the increment/decrement window is closed.
- Queue membership and `request.status === "queued"` move together: a request
  is removed from the queue before it starts, fails, or is evicted, and
  `queuedAtMs` is cleared whenever a request leaves the queue.
- `drop_oldest` eviction is not a dequeue start: evicted requests count toward
  `totalDropped` only, never `totalDequeued` or the queue-wait histogram.
- `component.effectiveConcurrency` is the single representation of derived
  capacity (written at registration and by `setComponentReplicas`);
  `getEffectiveConcurrency()` reads it rather than recomputing.
- Capacity bounds hold at every point: `replicas` is a positive integer and,
  when autoscaling is enabled, stays within `[autoscaling.min, autoscaling.max]`
  (initial replicas are clamped at registration, and `setComponentReplicas`
  refuses a scale-down whose `effectiveConcurrency` would fall below the
  component's current `activeRequests`). Consequently
  `0 <= component.activeRequests <= component.effectiveConcurrency` always
  holds and a component's queue size is never negative.
- Cache hits are the explicit capacity exception: a hit completes the request
  on the fast path without entering processing, so it never changes
  `activeRequests`. Only the miss path consumes and releases capacity.
- Metrics are a derived, frozen snapshot, never a second source of truth:
  `getMetrics()` reads component fields, the request map, and
  `componentRequestQueue` sizes (plus the store for counts with no single
  owner, e.g. network and retries) and deep-copies them, so no snapshot field
  aliases live state. Nothing reads the snapshot back into behavior.
  `requests.inFlight` is the non-terminal count (pending + queued + being
  processed), so `generated = completed + failed + inFlight`; the true
  processing count is `components[].traffic.active`.
- `simulation.currentTimeMs` mirrors the clock after every processed event so
  the domain object's progress cursor stays truthful; `reset` zeroes it.
- `attempts` is a shared budget across processing and network stages; both
  stages increment it before consulting the retry policy.
- The duration cutoff is truncating: events at or after `durationMs` are never
  processed, so requests mid-flight keep their status and counts in the final
  metrics snapshot.
- A failed component's `queue.drain` events no-op; recovery reschedules the
  drain so a non-empty queue is never stranded once the component is healthy
  again.
- Terminal request states are sticky: only `pending`/`in-flight`/`queued`
  requests may transition to `completed` or `failed`, and no event after a
  terminal state may resurrect the request, record metrics against it, or
  touch component capacity. Every request-lifecycle handler enforces this via
  `assertRequestNotTerminal`; the duration cutoff is the one documented case
  where a run ends with non-terminal requests.
- A queued request can only leave the queue via `queue.drain` →
  `request.processing_started` (dequeued, then in-flight once capacity is
  admitted). `request.completed` and `request.processing_completed` are
  rejected while a request is still queued (`assertRequestNotQueued`), so a
  request can never complete without having executed.

**Event scheduling & staleness**

- Every scheduled event type has exactly one producer path. Terminal request
  events (`request.completed`, `request.failed`) are mutually exclusive per
  request: a failure schedules either a retry or a terminal failure, never
  both, so handlers need no terminal-state guards — producer exclusivity is
  the invariant.
- Arrival events re-validate current state instead of trusting their payload.
  `request.processing_started` is the full gate (circuit → health → capacity →
  attempts → error rate); cache lookup and `component.scaled` re-check health
  and configuration at arrival; routing re-checks the circuit via
  `admitArrival`.
- Two staleness guards use generation counters: recovery events carry the
  generation of their failure period (a new failure bumps it, invalidating old
  timers), and `component.circuit_half_open` carries the circuit generation
  (re-opening bumps it). Stale events are ignored, never applied.
- Duplicate circuit trips are suppressed at the source: `recordCircuitFailure`
  returns early while the circuit is already open, so no duplicate
  `circuit_opened` event or half-open timer can be scheduled.
- `queue.drain` may be scheduled more than once for the same timestamp
  (completion + scale-up + recovery). This is benign: the second drain may
  dequeue up to the slots it sees, `processing_started` re-checks capacity and
  re-queues anything that no longer fits, and no request is lost or started
  twice — only queue metrics may count the round trip.
- `autoscaling.evaluate` forms a single chain: seeded once by
  `SimulationSession.prepare` (which runs only from `run()`), then extended
  one-for-one by `handleEvaluate`, bounded by the simulation duration.
- Observability-only events mutate no state. `component.health_changed`,
  `component.circuit_opened`, and `component.circuit_closed` have handlers
  that validate shape only; `queue.enqueue`, `queue.dequeue`, and
  `component.recovery_scheduled` intentionally have no handler and are
  ignored by the dispatcher.
- `request.failed → request.retry` and `request.completed → request.retry`
  are impossible by producer exclusivity (a failure schedules a retry _xor_ a
  terminal failure) and are asserted at handling time: any lifecycle event
  arriving for a terminal request throws instead of resurrecting it.
- Processing order is total and deterministic: the queue orders by
  `timestampMs` and then by insertion sequence, so events sharing a timestamp
  are processed in the order they were scheduled, and an event scheduled
  _during_ processing lands after the peers already queued at that timestamp.
  The clock advances monotonically to each processed event's timestamp and
  never moves backwards.

**What the engine does not do**

- Traffic generation, failure scheduling, and autoscaling initialization are
  **separate concerns**. They are composed by a `SimulationSession` (orchestrating
  `TrafficGenerator` + `FailureScheduler` + `AutoscalingScheduler`) ahead of the
  engine's execution, never embedded in the engine itself.

**Core interfaces**

- `SimulationEngine` — execution coordinator (start/step/pause/resume/cancel/run).
- `SimulationSession` — composes setup (load, failures, autoscaling) with the engine.
- `SimulationClock`
- `EventQueue`
- `EventProcessor`
- `SimulationRuntime`
- `TrafficGenerator` / `FailureScheduler` / `AutoscalingScheduler`

**Orchestration contract**

- Prepare once, then execute: `SimulationSession.prepare(entryNodeId)` populates
  load and schedules failures/autoscaling while the simulation is still
  `created`; `SimulationEngine.start()` enters `running` without processing
  anything; `step()`/`run()` then drain the queue. `session.run()` is exactly
  `prepare()` followed by `engine.run()`.
- `pause()` and `resume()` leave the clock and event queue untouched, so
  stepping resumes from the frozen timestamp rather than restarting at zero.
  `cancel()` records `completedAt` and also leaves the queue intact.
- `reset()` is a rewind, not a transition (see Lifecycle): it is available from
  every status and returns the runtime to a fresh, replayable state.
- The worker composes these same objects; no engine behavior depends on the
  API, HTTP, or the database.

**Known limitations (deferred)**

- Duplicate `queue.drain` events at the same timestamp may inflate queue
  round-trip metrics (dequeue/enqueue counts and queue-wait samples); no request
  is lost or started twice.
- A lost network transmission is detected at link latency, not at the moment the
  packet is dropped, so a `network_packet_loss` failure fires after the latency
  window elapses.
- Simulation configuration has no Zod boundary yet (the API schema will define
  it); engine-side numeric config is not exhaustively `Number.isFinite`-hardened
  beyond the simulation clock.
- Several documented config fields are accepted but unused by the MVP engine
  (`capacity`, `cpu`, `memory`, `traffic`, `timeoutMs`, `simulationSpeed`,
  `trafficRate`).

**Dependencies**

- Simulation domain
- Architecture snapshot
- Scenario configuration

**Must not depend on**

- Express
- HTTP request/response objects
- PostgreSQL
- Redis
- Controllers

The engine should be executable independently of the API.

---

## Simulation Worker

**Responsibility**

- Consume simulation jobs.
- Load required simulation data.
- Construct the `SimulationSession` and execute the simulation.
- Persist simulation progress/results.
- Report failures and completion.

**Interfaces**

- `SimulationQueue`
- `SimulationService`
- `SimulationSession`
- `SimulationEngine`

**Dependencies**

- Redis/BullMQ
- Database
- Simulation Engine
- Simulation domain

```text
Queue → Worker → Session (Engine) → Results
```

---

## Infrastructure

### Database

**Responsibility**

- PostgreSQL connection.
- Drizzle ORM configuration.
- Database schemas and migrations.

**Used by**

- Repositories only.

Modules should not access the database client directly.

### Queue

**Responsibility**

- BullMQ/Redis configuration.
- Enqueue and consume simulation jobs.

**Used by**

- Simulation service
- Simulation worker

### Auth Infrastructure

Contains implementation details for:

- JWT signing/verification.
- Password hashing.
- Authentication cookies.

Domain and application services depend on interfaces/utility contracts rather than HTTP concerns.

---

## Cross-Module Dependency Rules

```text
Auth
 ▲
 │ identity
Project
 ▲
 │ ownership
Architecture ─────► Scenario
     │                 │
     └───────┬─────────┘
             ▼
        Simulation
             │
             ▼
      Simulation Queue
             │
             ▼
      Simulation Worker
             │
             ▼
      Simulation Session
             │
             ▼
      Simulation Engine
```

### Rules

1. Controllers depend on services, never repositories directly.
2. Services depend on repositories/interfaces, not database implementations.
3. Repositories own persistence logic.
4. Domain code must remain independent of Express and infrastructure.
5. Simulation Engine must remain independent of HTTP, queues, and databases.
6. Modules should expose services/interfaces rather than internal implementation details.
7. Avoid circular dependencies between modules.
8. Shared infrastructure may be depended on by modules, but infrastructure must not depend on module internals.
9. Cross-module access should use the owning module's public interface.
10. Keep dependency direction moving toward domain/application logic, not infrastructure.

---

## Database Architecture

**Stack:** PostgreSQL with Drizzle ORM (node-postgres driver). A single shared
connection is created in `src/infrastructure/database/db.ts` from the
`DATABASE_URL` env var and reused by every repository. Migrations are generated
with Drizzle Kit into `backend/drizzle/` (see `drizzle.config.ts`); the
`schema/migrations/` directory is intentionally unused for now.

```text
users
  │
  ├── 1:N sessions            (user_id, on delete cascade)
  └── 1:N projects            (owner_id, on delete cascade)
          │
          └── 1:N architectures (project_id, on delete cascade)
                  │
                  ├── 1:N simulations  (architecture_id, on delete cascade)
                  │        │
                  │        ├── 1:N simulation_events (simulation_id, on delete cascade)
                  │        └── 1:N metrics           (simulation_id, on delete cascade)
                  │
                  └── 1:N scenarios    (architecture_id, on delete cascade)
```

### Tables

**users** (`schema/users.ts`) — platform accounts.

| Column                  | Type         | Notes                 |
| ----------------------- | ------------ | --------------------- |
| id                      | uuid         | PK, default random    |
| name                    | varchar(150) | not null              |
| email                   | varchar(255) | not null, unique      |
| password_hash           | text         | not null, bcrypt hash |
| avatar_url              | text         | nullable              |
| email_verified          | boolean      | default false         |
| created_at / updated_at | timestamp    | auto-managed          |

**sessions** (`schema/sessions.ts`) — login sessions, keyed by a hashed refresh token.

| Column             | Type      | Notes                         |
| ------------------ | --------- | ----------------------------- |
| id                 | uuid      | PK, default random            |
| user_id            | uuid      | FK → users, on delete cascade |
| refresh_token_hash | text      | not null                      |
| user_agent         | text      | nullable                      |
| ip_address         | text      | nullable                      |
| expires_at         | timestamp | not null                      |
| last_used_at       | timestamp | nullable                      |
| revoked_at         | timestamp | nullable                      |
| created_at         | timestamp | default now                   |

**projects** (`schema/projects.ts`) — top-level containers that own architectures.

| Column                  | Type         | Notes                                        |
| ----------------------- | ------------ | -------------------------------------------- |
| id                      | uuid         | PK, default random                           |
| owner_id                | uuid         | FK → users, on delete cascade, indexed       |
| name                    | varchar(150) | not null                                     |
| description             | text         | nullable                                     |
| visibility              | enum         | PRIVATE / PUBLIC / UNLISTED, default PRIVATE |
| created_at / updated_at | timestamp    | auto-managed                                 |

**architectures** (`schema/architectures.ts`) — a project's system graph stored as JSONB.

| Column                  | Type         | Notes                                         |
| ----------------------- | ------------ | --------------------------------------------- |
| id                      | uuid         | PK, default random                            |
| project_id              | uuid         | FK → projects, on delete cascade, indexed     |
| name                    | varchar(150) | not null                                      |
| description             | text         | nullable                                      |
| graph                   | jsonb        | `ArchitectureGraph` (nodes + edges), not null |
| created_at / updated_at | timestamp    | auto-managed                                  |

Unique on `(project_id, name)`.

**scenarios** (`schema/scenarios.ts`) — reusable lists of events replayed during a simulation.

| Column                  | Type         | Notes                                 |
| ----------------------- | ------------ | ------------------------------------- |
| id                      | uuid         | PK, default random                    |
| architecture_id         | uuid         | FK → architectures, on delete cascade |
| name                    | varchar(150) | not null                              |
| events                  | jsonb        | `ScenarioEvent[]`, not null           |
| created_at / updated_at | timestamp    | auto-managed                          |

**simulations** (`schema/simulations.ts`) — a run against an architecture plus its events and metrics.

| Column                                 | Type      | Notes                                                                        |
| -------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| id                                     | uuid      | PK, default random                                                           |
| architecture_id                        | uuid      | FK → architectures, on delete cascade, indexed                               |
| status                                 | enum      | created / running / paused / completed / failed / cancelled, default created |
| seed                                   | integer   | nullable; seed for the deterministic PRNG                                    |
| current_time_ms                        | integer   | default 0; engine progress cursor                                            |
| config                                 | jsonb     | `SimulationConfig`, nullable                                                 |
| snapshot                               | jsonb     | `ArchitectureGraph` snapshot, nullable                                       |
| started_at / completed_at / created_at | timestamp | lifecycle + creation                                                         |

**simulation_events** (`schema/simulations.ts`) — events emitted during a run, indexed by simulation + timestamp.

| Column        | Type      | Notes                               |
| ------------- | --------- | ----------------------------------- |
| id            | bigserial | PK                                  |
| simulation_id | uuid      | FK → simulations, on delete cascade |
| timestamp_ms  | integer   | not null                            |
| event_type    | varchar   | not null                            |
| payload       | jsonb     | not null                            |

**metrics** (`schema/simulations.ts`) — performance samples during a run.

| Column             | Type      | Notes                               |
| ------------------ | --------- | ----------------------------------- |
| id                 | bigserial | PK                                  |
| simulation_id      | uuid      | FK → simulations, on delete cascade |
| timestamp_ms       | integer   | not null                            |
| node_id            | varchar   | nullable; null = global sample      |
| requests_per_sec   | real      | nullable                            |
| avg_latency_ms     | real      | nullable                            |
| error_rate         | real      | nullable                            |
| queue_depth        | integer   | nullable                            |
| cache_hit_rate     | real      | nullable                            |
| active_connections | integer   | nullable                            |

### JSONB Type Shapes

Defined in `schema/types/types.ts` and typed via the domain layer:

- **`ArchitectureGraph`** — `{ nodes: ArchitectureNode[], edges: ArchitectureEdge[] }`. Stored on architectures and used as the immutable `simulation.snapshot`.
- **`SimulationConfig`** — configuration driving a simulation run (re-exported from `domain/simulation/simulation.types.ts`).
- **`ScenarioEvent`** — a discriminated union on `type`:
  `traffic_spike`, `service_failure`, `service_recovery`, `network_latency`, `packet_loss`.
  All variants share `id` and `timestampMs`; typed variant fields distinguish targets and rates.

### Access Rules

The database client (`db.ts`) and schemas are consumed **by repositories only**.
Controllers and services must never touch Drizzle/PostgreSQL directly — persistence
is owned by the repository layer, consistent with the cross-module rules above.
