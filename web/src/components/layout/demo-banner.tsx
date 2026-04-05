"use client";

import { useEffect, useState } from "react";
import { isDemoMode, disableDemo } from "@/lib/demo-mode";
import { FlaskConical, X } from "lucide-react";

export function DemoBanner() {
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    setDemo(isDemoMode());
  }, []);

  if (!demo) return null;

  return (
    <div className="bg-amber-500/90 text-black px-4 py-2 flex items-center justify-between text-sm font-medium">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4" />
        <span>Demo Mode — showing sample data, no real emails</span>
      </div>
      <button
        onClick={() => { disableDemo(); window.location.href = "/dashboard"; }}
        className="rounded px-2 py-0.5 hover:bg-black/10 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
