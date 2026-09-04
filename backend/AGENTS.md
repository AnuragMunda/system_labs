# AGENTS.md - Backend

## Backend Overview

The backend provides the REST API, authentication/authorization, project and architecture management, simulation orchestration, persistence, and real-time communication.

The MVP uses a **modular monolith** with a separate simulation worker process.

## Stack

- Runtime: Node.js - `<pinned version>`
- Language: TypeScript - `<pinned version>`
- Framework: Express - `<pinned version>`
- Package manager: pnpm - `<pinned version>`
- Database: PostgreSQL - `<pinned version>`
- ORM: Drizzle ORM - `<pinned version>`
- Validation: Zod - `<pinned version>`
- Cache/queue infrastructure: Redis + BullMQ
- Real-time: WebSockets
- Testing: Vitest + Supertest
- Quality: ESLint + Prettier
- Infrastructure: Docker / Docker Compose

Use the versions pinned in `package.json` and lockfile. Do not silently upgrade dependencies.

## Folder Responsibilities

- `domain/` — Pure business/domain types and rules. No Express or database dependencies.
- `modules/` — Application features and use cases.
- `simulation-engine/` — Deterministic simulation logic. Must remain framework-independent.
- `workers/` — Background process entry points.
- `infrastructure/` — Database, Redis, queues, JWT, cookies, and external technology.
- `middleware/` — Express middleware.
- `websocket/` — WebSocket server/gateways.
- `jobs/` — Scheduled/background maintenance jobs.
- `fixtures/` — Development/test sample data.
- `lib/` — Small shared infrastructure utilities.
- `tests/` — Tests organized by responsibility.

## Module Structure

A typical feature module should follow:

```text
modules/<feature>/
├── <feature>.controller.ts
├── <feature>.service.ts
├── <feature>.repository.ts
├── <feature>.routes.ts
├── <feature>.schema.ts
├── <feature>.dto.ts
└── index.ts
```

Use additional files only when complexity requires them.

## Hard Constraints

1. Express is the HTTP framework.
2. Use modular-monolith boundaries.
3. Controllers are functions, not classes.
4. Controllers handle HTTP concerns only.
5. `asyncHandler` belongs at the controller/route boundary.
6. Services contain business logic.
7. Repositories contain persistence logic only.
8. Never access Drizzle/PostgreSQL directly from controllers or services.
9. Use DTOs/Zod schemas at external boundaries.
10. Never trust `ownerId`/`userId` from request bodies.
11. Authentication derives identity from verified credentials.
12. Authorization is enforced in the backend.
13. Keep JWT implementation inside the authentication infrastructure.
14. Refresh tokens must be protected and revocable through sessions.
15. Never log secrets, passwords, raw tokens, or sensitive authentication data.
16. Simulation domain logic must remain independent from Express.
17. Simulation execution must be deterministic when using the same seed and snapshot.
18. Do not introduce microservices for MVP.
19. Do not add libraries when existing infrastructure can solve the problem.
20. Keep changes scoped to the requested task.

## Read Before Anything Else

Read in this exact order before any implementation:

1. src/modules/ARCHITECTURE.md
2. backend/PROGRESS.md

## Development Rule

Before changing a module, inspect its existing types, schemas, service, repository, controller, routes, and tests. Follow established patterns instead of creating a parallel architecture.

After making changes, make sure to run these:

- `pnpm test:all`
- `pnpm format:check`
- `pnpm format` (if format check fails)
- `pnpm lint`
- `pnpm build`
