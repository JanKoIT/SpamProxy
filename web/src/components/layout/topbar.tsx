"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { signOut, useSession } from "next-auth/react";
import { Bell, LogOut, User, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { apiFetch } from "@/hooks/use-demo-fetch";

type OverallStatus = "ok" | "degraded" | "error" | "unknown";

function StatusBadge() {
  const [overall, setOverall] = useState<OverallStatus>("unknown");
  const [detail, setDetail] = useState<string>("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/system-status");
      if (res.ok) {
        const json = await res.json();
        setOverall(json.overall);
        const problems = Object.entries(json.services || {})
          .filter(([, v]) => (v as { status: string }).status === "error" || (v as { status: string }).status === "degraded")
          .map(([k]) => k);
        setDetail(problems.length > 0 ? `Issues: ${problems.join(", ")}` : "All systems operational");
      } else {
        setOverall("error");
        setDetail("Status check failed");
      }
    } catch {
      setOverall("error");
      setDetail("Status check failed");
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 20000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const icon = overall === "ok"
    ? <CheckCircle2 className="h-4 w-4 text-green-400" />
    : overall === "degraded"
      ? <AlertTriangle className="h-4 w-4 text-yellow-400" />
      : overall === "error"
        ? <XCircle className="h-4 w-4 text-red-400" />
        : <span className="h-2 w-2 rounded-full bg-slate-500" />;

  const label = overall === "ok"
    ? "Operational"
    : overall === "degraded"
      ? "Degraded"
      : overall === "error"
        ? "Problem"
        : "Checking";

  const bg = overall === "ok"
    ? "border-green-500/20 bg-green-500/5 text-green-300"
    : overall === "degraded"
      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
      : overall === "error"
        ? "border-red-500/30 bg-red-500/10 text-red-300 animate-pulse"
        : "border-slate-700 bg-slate-800 text-slate-400";

  return (
    <Link
      href="/dashboard"
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:opacity-80 ${bg}`}
      title={detail}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

export default function Topbar() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex items-center justify-between h-16 px-6 bg-slate-900 border-b border-slate-700/50">
      <h1 className="text-lg font-semibold text-slate-100">SpamProxy</h1>

      <div className="flex items-center gap-3">
        <StatusBadge />

        <button
          className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            aria-label="User menu"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700">
              <User className="h-4 w-4 text-slate-300" />
            </div>
            <span className="hidden sm:inline text-slate-300">
              {session?.user?.name ?? "Admin"}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-lg bg-slate-800 border border-slate-700 shadow-xl z-50">
              <div className="px-4 py-3 border-b border-slate-700">
                <p className="text-sm text-white">{session?.user?.name}</p>
                <p className="text-xs text-slate-400">{session?.user?.email}</p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-slate-700 rounded-b-lg transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Abmelden
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
