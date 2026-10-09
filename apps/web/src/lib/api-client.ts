const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type ApiError = Error & { status?: number };

function httpError(message: string, status?: number): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  return err;
}

// One refresh at a time: parallel requests that all hit an expired access token share it.
let refreshing: Promise<string | null> | null = null;

function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (res.status === 401) {
        // The refresh token itself is expired or revoked: only now does the owner have to sign in again.
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        return null;
      }
      if (!res.ok) return null; // server trouble: keep the tokens, report the failure
      const data = await res.json();
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      return data.access_token as string;
    } catch {
      return null; // network blip: keep the tokens
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && token) {
    // Another request (or tab) may already have renewed the session while this one was in flight.
    const stored = localStorage.getItem("access_token");
    const renewed = stored && stored !== token ? stored : await refreshSession();
    if (renewed) {
      headers["Authorization"] = `Bearer ${renewed}`;
      const retry = await fetch(`${API_URL}/api/v1${path}`, {
        method: opts.method || "GET",
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!retry.ok) throw httpError(`API error: ${retry.status}`, retry.status);
      if (retry.status === 204) return undefined as T;
      return retry.json();
    }
    if (!localStorage.getItem("refresh_token")) {
      window.location.href = "/login";
      throw httpError("Session expired", 401);
    }
    throw httpError("Could not reach the server, try again", 503);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw httpError(err.detail || `API error: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: (path: string) => request<void>(path, { method: "DELETE" }),
};
