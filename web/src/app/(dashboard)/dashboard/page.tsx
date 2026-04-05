"use client";

import { useEffect, useState, useCallback } from "react";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { MailVolumeChart } from "@/components/dashboard/mail-volume-chart";
import { RefreshCw, Loader2 } from "lucide-react";

export default function DashboardPage() {
  const [stats, setStats] = useState<{
    total_today: number;
    spam_today: number;
    ham_today: number;
    quarantine_pending: number;
    spam_rate: number;
    hourly_stats: { hour: string; total: number; spam: number; ham: number }[];
  } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) setStats(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStats]);

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">SpamProxy Dashboard</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500"
            />
            Auto-refresh
          </label>
          <button onClick={fetchStats} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <StatsCards
        totalToday={stats.total_today}
        spamBlocked={stats.spam_today}
        quarantinePending={stats.quarantine_pending}
        spamRate={stats.spam_rate}
      />

      <MailVolumeChart hourlyStats={stats.hourly_stats} />
    </div>
  );
}
