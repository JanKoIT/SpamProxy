"use client";

import { useState } from "react";
import { Check, Loader2, UserPlus } from "lucide-react";

export function AddRecipientButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "exists" | "err">("idle");

  async function handleClick() {
    setState("loading");
    try {
      const res = await fetch("/api/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, daily_report_enabled: true }),
      });
      if (res.ok) {
        setState("done");
      } else if (res.status === 409) {
        setState("exists");
      } else {
        setState("err");
      }
    } catch {
      setState("err");
    }
  }

  const baseCls = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors";

  if (state === "done") {
    return (
      <span className={`${baseCls} border border-green-500/30 bg-green-500/10 text-green-300`}>
        <Check className="h-3 w-3" /> {email} angelegt
      </span>
    );
  }
  if (state === "exists") {
    return (
      <span className={`${baseCls} border border-slate-700 bg-slate-800 text-slate-400`}>
        {email} (bereits Empfänger)
      </span>
    );
  }
  if (state === "err") {
    return (
      <span className={`${baseCls} border border-red-500/30 bg-red-500/10 text-red-300`}>
        Fehler bei {email}
      </span>
    );
  }
  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      className={`${baseCls} border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 disabled:opacity-50`}
      title={`${email} als Daily-Report-Empfänger anlegen`}
    >
      {state === "loading" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <UserPlus className="h-3 w-3" />
      )}
      {email}
    </button>
  );
}
