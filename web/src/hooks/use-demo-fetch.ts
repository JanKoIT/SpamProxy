"use client";

import { isDemoMode } from "@/lib/demo-mode";

/**
 * Fetch wrapper that redirects to demo API in demo mode.
 * Use this instead of raw fetch() in client components.
 */
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  if (typeof window !== "undefined") {
    // Check URL params too (for first load before cookie is set)
    const isDemo = isDemoMode() || window.location.search.includes("demo");
    if (isDemo && url.startsWith("/api/") && !url.startsWith("/api/demo/") && !url.startsWith("/api/auth/")) {
      const [path] = url.split("?");
      return fetch(path.replace("/api/", "/api/demo/"), options);
    }
  }
  return fetch(url, options);
}
