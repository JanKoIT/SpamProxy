"use client";

import { isDemoMode } from "@/lib/demo-mode";

/**
 * Wraps fetch() to redirect API calls to demo endpoints in demo mode.
 * Usage: const data = await demoFetch("/api/stats");
 */
export function demoFetch(url: string, options?: RequestInit): Promise<Response> {
  if (isDemoMode() && url.startsWith("/api/") && !url.startsWith("/api/demo/")) {
    const demoUrl = url.replace("/api/", "/api/demo/");
    return fetch(demoUrl, options);
  }
  return fetch(url, options);
}
