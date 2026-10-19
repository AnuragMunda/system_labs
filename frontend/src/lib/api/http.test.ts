import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "./auth-token";
import { apiFetch, ApiClientError } from "./http";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okEnvelope<T>(data: T) {
  return { success: true, message: "ok", data };
}

function unauthorized() {
  return { success: false, message: "expired", code: "UNAUTHORIZED" };
}

let fetchMock: FetchMock;

beforeEach(() => {
  setAccessToken("old-token");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("apiFetch happy path", () => {
  it("returns envelope data and sends the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, okEnvelope({ id: "s1" })));

    const data = await apiFetch<{ id: string }>("/api/v1/simulations/s1");

    expect(data).toEqual({ id: "s1" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("Authorization")).toBe(
      "Bearer old-token",
    );
  });
});

describe("apiFetch 401 refresh flow", () => {
  it("refreshes and retries once on a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, unauthorized()))
      .mockResolvedValueOnce(
        jsonResponse(200, okEnvelope({ accessToken: "new-token" })),
      )
      .mockResolvedValueOnce(jsonResponse(200, okEnvelope({ id: "s1" })));

    const data = await apiFetch<{ id: string }>("/api/v1/simulations/s1");

    expect(data).toEqual({ id: "s1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Second call is the raw refresh request.
    const [refreshUrl] = fetchMock.mock.calls[1] as [string];
    expect(refreshUrl).toContain("/api/v1/auth/refresh");
    // Third call is the retried original with the refreshed token.
    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryInit.headers as Headers).get("Authorization")).toBe(
      "Bearer new-token",
    );
  });

  it("throws and notifies on auth failure without retrying when refresh fails", async () => {
    const onAuthFailure = vi.fn();
    const { setAuthFailureHandler } = await import("./http");
    setAuthFailureHandler(onAuthFailure);

    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, unauthorized()))
      .mockResolvedValueOnce(jsonResponse(401, unauthorized()));

    await expect(
      apiFetch("/api/v1/simulations/s1"),
    ).rejects.toThrow(ApiClientError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);

    setAuthFailureHandler(null);
  });

  it("does not trigger refresh for auth endpoints", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, unauthorized()));

    await expect(apiFetch("/api/v1/auth/login")).rejects.toThrow(
      ApiClientError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
