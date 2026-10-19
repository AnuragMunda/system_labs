# Simulation API Reference

Frontend-facing contract for the simulation module. It describes every endpoint,
the request/response shapes, authentication and visibility rules, lifecycle
semantics, and error behavior.

- **Base path:** `/api/v1/simulations`
- **Content type:** `application/json`
- **Auth:** `Authorization: Bearer <accessToken>` (see the auth module)
- **Types:** request schemas live in `simulation.schema.ts`; response views are
  `SimulationDetails`, `SimulationStatusView`, `SimulationSummary`, and
  `SimulationResultView` in `simulation.dto.ts`; metrics are typed in
  `@/domain/simulation/metrics.types.ts`.

## Response envelope

Every response (success or failure) uses the same envelope.

Success:

```json
{ "success": true, "message": "Simulation created successfully", "data": {} }
```

`data` is omitted when a controller returns no payload. Failure:

```json
{ "success": false, "message": "Resource not found", "code": "NOT_FOUND" }
```

Some failures add `details` (e.g. validation issues). In development,
`stack` is also included. All timestamps are **ISO-8601 strings** over JSON
(e.g. `"2026-10-14T12:00:00.000Z"`) or `null`.

## Lifecycle model

Statuses: `created` → `running` ⇄ `paused` → `completed` | `failed` | `cancelled`.

| Action             | Allowed from                   | Result      |
| ------------------ | ------------------------------ | ----------- |
| `POST /:id/start`  | `created`                      | `running`   |
| `POST /:id/pause`  | `running`                      | `paused`    |
| `POST /:id/resume` | `paused`                       | `running`   |
| `POST /:id/cancel` | `created`, `running`, `paused` | `cancelled` |
| _(internal)_       | `running` (queue exhausted)    | `completed` |
| _(internal)_       | `created`, `running`, `paused` | `failed`    |

Terminal states (`completed`, `failed`, `cancelled`) are permanent — controlling
a terminal run returns `409 CONFLICT`. `start` is asynchronous: it responds
`202 Accepted` immediately and the run proceeds in the background. Poll
`GET /:id/status` until terminal (optionally alongside `GET /:id/metrics` for
live per-component metrics), then read `GET /:id/results`.

> The frontend's presentation labels (e.g. "passed"/"degraded"/"failed") are an
> outcome derived from the metrics, not the backend lifecycle status.

## Configuration (`SimulationConfig`)

Passed as `config` on create. The traffic source is separate (`sourceNodeId`)
because it describes topology, not load shape.

| Field                | Type                       | Required | Default  | Notes                                                                                             |
| -------------------- | -------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------- |
| `durationMs`         | integer `> 0`              | yes      | —        | Total simulated duration.                                                                         |
| `requestsPerSecond`  | number `>= 0`              | yes      | —        | Initial load rate.                                                                                |
| `simulationSpeed`    | number `> 0`               | no       | `1`      | Playback speed (1 = real-time).                                                                   |
| `randomSeed`         | integer                    | no       | `0`      | Same architecture + config + seed ⇒ same result.                                                  |
| `collectMetrics`     | boolean                    | no       | `true`   | Whether metrics are collected.                                                                    |
| `emitEvents`         | boolean                    | no       | `true`   | Whether events are emitted (for future replay).                                                   |
| `cacheKeys`          | string[]                   | no       | —        | Stable keys requests cycle through for cache hits.                                                |
| `databaseOperations` | (`"read"`\|`"write"`)[]    | no       | `"read"` | DB operations cycled round-robin.                                                                 |
| `failures`           | `{ nodeId, failedAtMs }[]` | no       | —        | `failedAtMs` integer `>= 0` and `< durationMs`; `nodeId` must exist in the architecture snapshot. |

Validation summary: unknown/missing required fields → `400 BAD_REQUEST`; a
scheduled failure whose node is absent from the snapshot, or whose time is not
strictly before `durationMs`, → `400 BAD_REQUEST` at create time.

## Endpoints

### `POST /api/v1/simulations` — create

Auth: **required**; caller must own the architecture's parent project.

Request:

```json
{
  "architectureId": "6a58bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
  "sourceNodeId": "client-1",
  "config": {
    "durationMs": 60000,
    "requestsPerSecond": 500,
    "randomSeed": 42,
    "failures": [{ "nodeId": "api-1", "failedAtMs": 20000 }]
  }
}
```

Response `201` — `data` is `SimulationDetails`:

```json
{
  "success": true,
  "message": "Simulation created successfully",
  "data": {
    "id": "9b3c1a2e-7d4f-4c8a-9f21-2b6d0e5a7c34",
    "architectureId": "6a58bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
    "status": "created",
    "seed": 42,
    "currentTimeMs": 0,
    "sourceNodeId": "client-1",
    "config": {
      "durationMs": 60000,
      "requestsPerSecond": 500,
      "simulationSpeed": 1,
      "collectMetrics": true,
      "emitEvents": true,
      "randomSeed": 42,
      "failures": [{ "nodeId": "api-1", "failedAtMs": 20000 }]
    },
    "snapshot": { "nodes": [], "edges": [] },
    "startedAt": null,
    "completedAt": null,
    "error": null,
    "createdAt": "2026-10-14T12:00:00.000Z"
  }
}
```

### `GET /api/v1/simulations` — list

Auth: **required**; returns simulations in the caller's own projects, newest
first.

Query params (all optional; validated):

| Param            | Type         | Default | Notes                       |
| ---------------- | ------------ | ------- | --------------------------- |
| `architectureId` | uuid         | —       | Filter to one architecture. |
| `projectId`      | uuid         | —       | Filter to one project.      |
| `page`           | int `>= 1`   | `1`     | 1-based page number.        |
| `limit`          | int `1..100` | `20`    | Page size.                  |

Response `200` — `data` is `PaginatedResult<SimulationSummary>`. Items are
lightweight and **never** include `snapshot`, `config`, or `result`:

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "items": [
      {
        "id": "9b3c1a2e-7d4f-4c8a-9f21-2b6d0e5a7c34",
        "architectureId": "6a58bb24-2f9b-4e40-a1c5-4d2d5bce0f91",
        "status": "completed",
        "seed": 42,
        "currentTimeMs": 60000,
        "durationMs": 60000,
        "startedAt": "2026-10-14T12:00:01.000Z",
        "completedAt": "2026-10-14T12:00:03.000Z",
        "error": null,
        "createdAt": "2026-10-14T12:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

### `GET /api/v1/simulations/:id` — details

Auth: **optional** (visibility-governed). Response `200` — `data` is
`SimulationDetails` (same shape as create). Includes the captured `snapshot` and
`config`.

### `GET /api/v1/simulations/:id/status` — status (poll target)

Auth: **optional** (visibility-governed). Response `200` — `data` is
`SimulationStatusView`:

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "id": "9b3c1a2e-7d4f-4c8a-9f21-2b6d0e5a7c34",
    "status": "running",
    "currentTimeMs": 15000,
    "durationMs": 60000,
    "startedAt": "2026-10-14T12:00:01.000Z",
    "completedAt": null,
    "error": null
  }
}
```

Progress = `currentTimeMs / durationMs` (guard against `durationMs` being `null`
or `0`). When `status` is `failed`, `error` carries the failure reason.

### `GET /api/v1/simulations/:id/metrics` — live metrics

Auth: **optional** (visibility-governed). Returns the run's `SimulationMetrics`
(the same shape as the `metrics` field of `GET /:id/results`) at its **current
virtual time** while the run is in-flight. Clients poll this during an active
run to drive a live view of per-component traffic, latency, queue depth, and
health. The response is a read-only snapshot; it never aliases mutable engine
state, so it is safe to serve concurrently with execution.

- `running`/`paused` → `200` with the live in-memory snapshot. `409 CONFLICT`
  (`message: "Simulation metrics are not ready yet."`) in the brief window after
  `start` claims the run but before the engine has registered it — retry on the
  next poll.
- `completed` → `200` with the persisted aggregate report.
- `created` → `409 CONFLICT` (`message: "Simulation has not been started."`).
- `failed`/`cancelled` → `404 NOT_FOUND` (no report is persisted for these).

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "simulationId": "9b3c1a2e-7d4f-4c8a-9f21-2b6d0e5a7c34",
    "durationMs": 60000,
    "processedDurationMs": 15000,
    "recordedAtMs": 15000,
    "collectMetrics": true,
    "requests": { "…": "…" },
    "components": { "api-1": { "nodeId": "api-1", "type": "api", "…": "…" } },
    "health": { "byNode": {} }
  }
}
```

### `GET /api/v1/simulations/:id/results` — final results

Auth: **optional** (visibility-governed). Response `200` only once a **completed**
run has persisted its aggregate report:

```json
{
  "success": true,
  "message": "Request successful",
  "data": {
    "simulation": { "id": "…", "status": "completed", "…": "…" },
    "metrics": {
      "simulationId": "9b3c1a2e-7d4f-4c8a-9f21-2b6d0e5a7c34",
      "durationMs": 60000,
      "processedDurationMs": 60000,
      "recordedAtMs": 60000,
      "collectMetrics": true,
      "requests": {
        "generated": 30000,
        "completed": 29700,
        "failed": 300,
        "successRate": 0.99,
        "errorRate": 0.01,
        "inFlight": 0,
        "queued": 0,
        "retries": 0,
        "failedByReason": {}
      },
      "failures": { "total": 300, "byReason": {}, "byNode": {} },
      "network": { "…": "…" },
      "latency": { "…": "…" },
      "components": { "api-1": { "nodeId": "api-1", "type": "api", "…": "…" } },
      "cache": { "totals": { "…": "…" }, "byNode": {} },
      "database": { "totals": { "…": "…" }, "byNode": {} },
      "queues": { "totals": { "…": "…" }, "byNode": {} },
      "autoscaling": { "byNode": {} },
      "health": { "byNode": {} }
    }
  }
}
```

Returns `404 NOT_FOUND` when the run is `created`/`running`/`paused`/`failed`/
`cancelled` (no report persisted), or when the run is hidden/unknown. See
`metrics.types.ts` for the complete, documented metrics shape.

### `POST /api/v1/simulations/:id/start` — start

Auth: **required**; caller must own the project. Response `202 Accepted` — `data`
is `SimulationDetails` with `status: "running"`. `409 CONFLICT` if the run is not
`created` (already running or terminal).

### `POST /api/v1/simulations/:id/pause` — pause

Auth: **required**; owner. Response `200` — `data` is `SimulationDetails` with
`status: "paused"`. `409 CONFLICT` unless the run is `running`.

### `POST /api/v1/simulations/:id/resume` — resume

Auth: **required**; owner. Response `200` — `data` is `SimulationDetails` with
`status: "running"`. `409 CONFLICT` unless the run is `paused`.

### `POST /api/v1/simulations/:id/cancel` — cancel

Auth: **required**; owner. Response `200` — `data` is `SimulationDetails` with
`status: "cancelled"`. `409 CONFLICT` for terminal runs.

## Authentication & visibility

- **Writes** (create, start, pause, resume, cancel) and **list** require a valid
  Bearer token. Creating/controlling a run under a project the caller does not own
  → `403 FORBIDDEN`. `list`/`create` derive ownership from the token; client
  ownership ids are never trusted.
- **Reads** (details, status, metrics, results) inherit the parent project's
  visibility: `PUBLIC` and `UNLISTED` are visible to anyone; `PRIVATE` is visible
  only to its owner. Non-owners and anonymous callers receive `404 NOT_FOUND` so
  a private run's existence is not disclosed.

## Error contract

| Status | `code`              | When                                                                                                                             |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`       | Invalid body/query (`message: "Validation failed"` + `details`), invalid `:id`, missing source/failure node, malformed JSON.     |
| 401    | `UNAUTHORIZED`      | Missing/invalid Bearer token.                                                                                                    |
| 403    | `FORBIDDEN`         | Authenticated but not the owner (create/controls).                                                                               |
| 404    | `NOT_FOUND`         | Unknown/hidden run, unknown architecture on create, results/metrics not yet available (or no report for a failed/cancelled run). |
| 409    | `CONFLICT`          | Illegal lifecycle transition, a lost concurrent race, or metrics requested for a `created`/not-yet-registered run.               |
| 413    | `PAYLOAD_TOO_LARGE` | Request body exceeds the limit.                                                                                                  |
| 500    | `INTERNAL_ERROR`    | Unexpected server failure.                                                                                                       |

Validation failures include structured issues:

```json
{
  "success": false,
  "message": "Validation failed",
  "code": "BAD_REQUEST",
  "details": [
    {
      "path": "config.durationMs",
      "message": "Invalid input: expected number, received undefined"
    }
  ]
}
```

For `409`, the machine-readable `code` is the stable contract; `message` is
human-readable and may differ between an illegal transition and a lost race.

## Not yet available (deferred)

- Streaming simulation **events**/**telemetry** over WebSocket/SSE
  (`emitEvents`/`collectMetrics` are stored/derived but not streamed yet; live
  metrics are polled via `GET /:id/metrics` in the meantime).
- Sample-level metrics series (`simulation_events`, `metrics` tables); only
  snapshots (`GET /:id/metrics`) and the final aggregate report are exposed.
