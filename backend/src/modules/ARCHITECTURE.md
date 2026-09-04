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

- Execute deterministic simulations.
- Maintain simulation time.
- Schedule and process simulation events.
- Execute component behavior.
- Generate metrics and simulation events.

**Core interfaces**

- `SimulationEngine`
- `SimulationClock`
- `EventQueue`
- `SimulationComponent`
- `MetricsCollector`

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
- Construct and execute the `SimulationEngine`.
- Persist simulation progress/results.
- Report failures and completion.

**Interfaces**

- `SimulationQueue`
- `SimulationService`
- `SimulationEngine`

**Dependencies**

- Redis/BullMQ
- Database
- Simulation Engine
- Simulation domain

```text
Queue → Worker → Engine → Results
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
