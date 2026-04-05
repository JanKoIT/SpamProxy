"use client";

import { useEffect } from "react";
import { isDemoMode, enableDemo } from "@/lib/demo-mode";

export function DemoFetchProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Also activate demo if ?demo is in URL (for headless browsers/first visit)
    if (typeof window !== "undefined" && window.location.search.includes("demo")) {
      enableDemo();
    }

    if (!isDemoMode()) return;

    const originalFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.startsWith("/api/") && !url.startsWith("/api/demo/") && !url.startsWith("/api/auth/")) {
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
