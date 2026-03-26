const BASE_URL = import.meta.env.VITE_API_URL || "/api";

// Simple GET request cache
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Auto-logout on 401
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw { status: res.status, detail: body.detail ?? res.statusText };
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function get<T>(path: string, useCache = true): Promise<T> {
  const cacheKey = path;
  if (useCache) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data as T;
    }
  }

  const data = await request<T>(path);

  if (useCache) {
    cache.set(cacheKey, { data, timestamp: Date.now() });
  }
  return data;
}

export function invalidateCache(pathPrefix?: string) {
  if (pathPrefix) {
    for (const key of cache.keys()) {
      if (key.startsWith(pathPrefix)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}

export function post<T>(path: string, body: unknown) {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function patch<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function put<T>(path: string, body: unknown) {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function del(path: string) {
  return request<void>(path, { method: "DELETE" });
}
