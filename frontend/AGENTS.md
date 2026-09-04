<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md - Frontend

## Frontend Overview

The frontend is the visual workspace for the Interactive System Design Simulator.

It provides:

* Project and architecture management.
* Visual architecture editing.
* Component/node configuration.
* Simulation configuration and execution.
* Real-time simulation state and event visualization.
* Metrics, dashboards, failures, and system inspection.

The frontend communicates with the independent Express backend through APIs and WebSockets.

## Stack

* Framework: Next.js - `<pinned version>`
* UI library: React - `<pinned version>`
* Language: TypeScript - `<pinned version>`
* Package manager: pnpm - `<pinned version>`
* Styling: Tailwind CSS - `<pinned version>`
* Diagram/editor: React Flow - `<pinned version>`
* Client state: Redux - `<pinned version>`
* Server state/API: TanStack Query - `<pinned version>`
* Testing: Vitest - `<pinned version>`
* Quality: ESLint + Prettier

Use the versions pinned in `package.json` and lockfile. Do not silently upgrade dependencies.

## Folder Responsibilities

* `app/` — Next.js routes, layouts, and page composition.
* `features/` — Feature-specific UI, hooks, state, types, and utilities.
* `components/` — Reusable UI and layout components shared across features.
* `lib/api/` — API client and request infrastructure.
* `lib/websocket/` — WebSocket connection and transport infrastructure.
* `stores/` — Truly global client state only.
* `types/` — Shared frontend-wide types.
* `config/` — Frontend configuration.
* `public/` — Static assets.

Prefer feature-local code over putting feature-specific code into global folders.

## Hard Constraints

1. Frontend and backend remain separate applications.
2. Do not introduce a monorepo.
3. TypeScript strictness must remain enabled.
4. Do not duplicate backend business logic in the frontend.
5. Do not call the database or backend infrastructure directly from UI components.
6. API communication should use the established API/client layer.
7. Server state belongs in TanStack Query.
8. Global client/editor state belongs in Zustand only when appropriate.
9. Keep temporary/local UI state local to the component.
10. Keep React Flow concerns isolated from domain/business logic.
11. Do not put large amounts of business logic inside page/components.
12. Validate and type API responses at the application boundary.
13. Do not store secrets in frontend code or environment variables exposed to the browser.
14. Never assume authorization based on frontend state; the backend is authoritative.
15. Simulation state received from the backend must not be treated as authoritative configuration.
16. Architecture editing and simulation execution must remain conceptually separate.
17. Avoid unnecessary re-renders in the architecture editor and simulation visualizations.
18. Do not add dependencies without a clear requirement.
19. Preserve existing UI patterns and component conventions.
20. Complete one task at a time and avoid unrelated refactoring.

## Development Rule

Before changing a feature, inspect the existing pages, components, hooks, state, API layer, and types. Reuse established patterns before introducing new abstractions.