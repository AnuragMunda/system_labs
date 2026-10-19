import { getAccessToken, setAccessToken } from "./auth-token";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data?: T;
  code?: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Auth endpoints must never trigger the refresh-and-retry flow: a 401 from
// `refresh`/`login`/`register` means the credentials really are rejected.
const AUTH_PATH_PREFIX = "/api/v1/auth/";

function isAuthPath(path: string): boolean {
  return path.startsWith(AUTH_PATH_PREFIX);
}

// Registered by the store to clear session state when a refresh ultimately
// fails. Kept as a callback to avoid a store → http → store import cycle.
let authFailureHandler: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler;
}

interface ParsedResponse<T> {
  response: Response;
  body: ApiEnvelope<T> | null;
}

async function send<T>(path: string, init: RequestInit): Promise<ParsedResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // Non-JSON bodies (e.g. empty) are treated as a generic failure below.
  }

  return { response, body };
}

// Single-flight token refresh: concurrent 401s share one refresh request so the
// backend's rotating refresh cookie is only consumed once.
let refreshPromise: Promise<string> | null = null;

async function requestNewAccessToken(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Session refresh failed");
  }

  const body = (await response.json()) as ApiEnvelope<{
    accessToken: string;
  }>;
  const token = body?.data?.accessToken;
  if (!token) {
    throw new Error("Session refresh returned no access token");
  }

  setAccessToken(token);
  return token;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = requestNewAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let { response, body } = await send<T>(path, init);

  // Recover from an expired access token by refreshing once and retrying. The
  // raw fetch keeps this independent of the auth API surface (no recursion).
  if (response.status === 401 && !isAuthPath(path)) {
    try {
      await refreshAccessToken();
    } catch {
      setAccessToken(null);
      authFailureHandler?.();
      throw new ApiClientError(
        body?.message ?? "Your session has expired. Please sign in again.",
        response.status,
        body?.code ?? "UNAUTHORIZED",
        (body as { details?: unknown } | null)?.details,
      );
    }

    ({ response, body } = await send<T>(path, init));
  }

  const ok = response.ok && body?.success === true;
  if (!ok) {
    throw new ApiClientError(
      body?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.code,
      (body as { details?: unknown } | null)?.details,
    );
  }

  return body!.data as T;
}
