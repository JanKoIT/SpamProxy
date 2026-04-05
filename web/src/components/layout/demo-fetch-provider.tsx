"use client";

import { useEffect } from "react";
import { isDemoMode } from "@/lib/demo-mode";

/**
 * In demo mode, monkey-patches global fetch() to redirect
 * /api/* calls to /api/demo/* which returns fake data.
 */
export function DemoFetchProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!isDemoMode()) return;

    const originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.startsWith("/api/") && !url.startsWith("/api/demo/") && !url.startsWith("/api/auth/")) {
        // Strip query params for demo routing, keep the path
        const [path] = url.split("?");
        const demoUrl = path.replace("/api/", "/api/demo/");
        return originalFetch(demoUrl, init);
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return <>{children}</>;
}
