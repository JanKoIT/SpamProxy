"use client";
import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/hooks/use-demo-fetch";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Loader2 } from "lucide-react";

type ServiceStatus = {
  status: "ok" | "degraded" | "error" | "disabled";
  detail: string;
};

type SystemStatus = {
  overall: "ok" | "degraded" | "error";
  services: Record<string, ServiceStatus>;
  timestamp: string;
};

const SERVICE_LABELS: Record<string, string> = {
  rspamd: "rspamd (Spam Scanner)",
  postgres: "PostgreSQL",
  redis: "Redis",
  clamav: "ClamAV (Virus Scanner)",
  postfix: "Postfix (SMTP)",
  unbound: "Unbound (DNS)",
  ai: "AI Classifier",
};

const CRITICAL = new Set(["rspamd", "postgres", "postfix"]);

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "ok":
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case "degraded":
      return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "disabled":
      return <MinusCircle className="h-4 w-4 text-slate-500" />;
    default:
      return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  }
}

export function SystemStatusCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/system-status");
      if (res.ok) {
        setStatus(await res.json());
      } else {
        setStatus({
          overall: "error",
          services: {},
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      setStatus({
        overall: "error",
        services: {},
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading && !status) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Checking system status...</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  const overallBorder =
    status.overall === "ok"
      ? "border-green-500/30 bg-green-500/5"
      : status.overall === "degraded"
      ? "border-yellow-500/30 bg-yellow-500/5"
      : "border-red-500/30 bg-red-500/5";

  const overallLabel =
    status.overall === "ok"
      ? "All systems operational"
      : status.overall === "degraded"
      ? "Partial degradation"
      : "Problem detected";

  const overallTextColor =
    status.overall === "ok"
      ? "text-green-400"
      : status.overall === "degraded"
      ? "text-yellow-400"
      : "text-red-400";

  return (
    <div className={`rounded-lg border ${overallBorder} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon status={status.overall} />
          <h3 className={`text-sm font-semibold ${overallTextColor}`}>
            System Status: {overallLabel}
          </h3>
        </div>
        <span className="text-xs text-slate-500">
          {new Date(status.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(status.services).map(([name, svc]) => (
          <div
            key={name}
            className="flex items-start gap-2 rounded-md bg-slate-900/40 px-3 py-2"
            title={svc.detail}
          >
            <StatusIcon status={svc.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-sm text-white">
                <span className="truncate">{SERVICE_LABELS[name] ?? name}</span>
                {CRITICAL.has(name) && (
                  <span className="text-xs text-slate-500">•</span>
                )}
              </div>
              <div className="truncate text-xs text-slate-400">{svc.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
