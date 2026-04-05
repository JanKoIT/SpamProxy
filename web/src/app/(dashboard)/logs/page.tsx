"use client";
import { apiFetch } from "@/hooks/use-demo-fetch";

import { useEffect, useState, useCallback } from "react";
import { LearnButtons } from "@/components/logs/learn-buttons";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  RefreshCw,
  X,
  Eye,
} from "lucide-react";

interface LogEntry {
  id: string;
  message_id: string | null;
  mail_from: string | null;
  rcpt_to: string[];
  subject: string | null;
  direction: string;
  action: string;
  rspamd_score: number | null;
  ai_score: number | null;
  final_score: number | null;
  rspamd_symbols: Record<string, { score: number; description?: string }> | null;
  client_ip: string | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  delivered: "bg-green-500/20 text-green-400 border-green-500/30",
  quarantined: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  error: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${day}.${mon}.${year} ${hour}:${min}:${sec}`;
}

export default function LogsPage() {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const pageSize = 50;

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    if (direction) params.set("direction", direction);
    if (action) params.set("action", action);
    if (search) params.set("search", search);
    try {
      const res = await apiFetch(`/api/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, direction, action, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Mail Log</h1>
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
          <button onClick={fetchLogs} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-900 p-3">
        <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search sender, subject..."
            className="w-full rounded-md border border-slate-700 bg-slate-800 py-1.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </form>
        <div className="flex rounded-md border border-slate-700 bg-slate-800">
          {["", "inbound", "outbound"].map((v) => (
            <button key={v} onClick={() => { setDirection(v); setPage(1); }}
              className={`px-3 py-1.5 text-xs transition-colors ${direction === v ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-700"} first:rounded-l-md last:rounded-r-md`}
            >{v || "All"}</button>
          ))}
        </div>
        <div className="flex rounded-md border border-slate-700 bg-slate-800">
          {["", "delivered", "quarantined", "rejected"].map((v) => (
            <button key={v} onClick={() => { setAction(v); setPage(1); }}
              className={`px-3 py-1.5 text-xs transition-colors ${action === v ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-700"} first:rounded-l-md last:rounded-r-md`}
            >{v || "All"}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="px-3 py-2.5 font-medium">Date</th>
              <th className="px-3 py-2.5 font-medium">Dir</th>
              <th className="px-3 py-2.5 font-medium">From</th>
              <th className="px-3 py-2.5 font-medium">To</th>
              <th className="px-3 py-2.5 font-medium">Subject</th>
              <th className="px-3 py-2.5 font-medium text-right">Score</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
              <th className="px-3 py-2.5 font-medium">Learn</th>
              <th className="px-3 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">No log entries found.</td></tr>
            )}
            {items.map((log) => (
              <tr key={log.id} className="hover:bg-slate-800/60 transition-colors">
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-400">{formatDate(log.created_at)}</td>
                <td className="px-3 py-2.5">
                  {log.direction === "inbound" ? (
                    <span title="Inbound"><ArrowDownLeft className="h-4 w-4 text-blue-400" /></span>
                  ) : (
                    <span title="Outbound"><ArrowUpRight className="h-4 w-4 text-purple-400" /></span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-300 text-xs" title={log.mail_from ?? ""}>
                  {log.mail_from ?? "-"}
                </td>
                <td className="px-3 py-2.5 text-slate-300 text-xs" title={log.rcpt_to.join(", ")}>
                  {log.rcpt_to.join(", ") || "-"}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2.5 text-white text-xs" title={log.subject ?? ""}>
                  {log.subject ?? "-"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">
                  <span className={
                    log.final_score != null
                      ? log.final_score >= 10 ? "text-red-400" : log.final_score >= 5 ? "text-yellow-400" : "text-green-400"
                      : "text-slate-500"
                  }>
                    {log.final_score != null ? log.final_score.toFixed(1) : "-"}
                  </span>
                  {log.ai_score != null && (
                    <span className="ml-1 text-purple-400/60" title={`AI: ${log.ai_score.toFixed(1)}`}>
                      ai:{log.ai_score.toFixed(1)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-slate-700 text-slate-300"}`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-3 py-2.5"><LearnButtons logId={log.id} /></td>
                <td className="px-3 py-2.5">
                  <button onClick={() => setDetail(log)} className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white transition-colors" title="Details">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-slate-400">
        <p>Showing {Math.min((page - 1) * pageSize + 1, total)}&ndash;{Math.min(page * pageSize, total)} of {total}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="rounded-md p-2 text-slate-300 hover:bg-slate-800 disabled:text-slate-600 disabled:pointer-events-none">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 text-white">{page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
            className="rounded-md p-2 text-slate-300 hover:bg-slate-800 disabled:text-slate-600 disabled:pointer-events-none">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Mail Details</h2>
              <button onClick={() => setDetail(null)} className="rounded-md p-1 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">From:</span> <span className="text-white break-all">{detail.mail_from ?? "-"}</span></div>
                <div><span className="text-slate-500">To:</span> <span className="text-white break-all">{detail.rcpt_to.join(", ")}</span></div>
                <div><span className="text-slate-500">Subject:</span> <span className="text-white break-all">{detail.subject ?? "-"}</span></div>
                <div><span className="text-slate-500">Date:</span> <span className="text-white">{formatDate(detail.created_at)}</span></div>
                <div><span className="text-slate-500">Direction:</span> <span className="text-white">{detail.direction}</span></div>
                <div><span className="text-slate-500">Client IP:</span> <span className="text-white font-mono">{detail.client_ip ?? "-"}</span></div>
                <div><span className="text-slate-500">Message-ID:</span> <span className="text-white font-mono text-xs break-all">{detail.message_id ?? "-"}</span></div>
                <div>
                  <span className="text-slate-500">Action:</span>{" "}
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[detail.action] ?? ""}`}>{detail.action}</span>
                </div>
              </div>

              {/* Scores */}
              <div className="rounded-lg bg-slate-800 p-4">
                <h3 className="text-sm font-semibold text-white mb-2">Scores</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-slate-400">rspamd</p>
                    <p className={`text-xl font-bold ${detail.rspamd_score != null && detail.rspamd_score >= 5 ? "text-red-400" : "text-green-400"}`}>
                      {detail.rspamd_score != null ? detail.rspamd_score.toFixed(1) : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">AI</p>
                    <p className="text-xl font-bold text-purple-400">
                      {detail.ai_score != null ? detail.ai_score.toFixed(1) : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Final</p>
                    <p className={`text-xl font-bold ${detail.final_score != null && detail.final_score >= 5 ? "text-red-400" : "text-green-400"}`}>
                      {detail.final_score != null ? detail.final_score.toFixed(1) : "-"}
                    </p>
                  </div>
                </div>
              </div>

              {/* rspamd Symbols */}
              {detail.rspamd_symbols && Object.keys(detail.rspamd_symbols).length > 0 && (
                <div className="rounded-lg bg-slate-800 p-4">
                  <h3 className="text-sm font-semibold text-white mb-2">rspamd Symbols</h3>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {Object.entries(detail.rspamd_symbols)
                      .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0))
                      .map(([name, sym]) => (
                        <div key={name} className="flex items-center justify-between text-xs py-1 border-b border-slate-700/50">
                          <div>
                            <span className="font-mono text-white">{name}</span>
                            {sym.description && <span className="ml-2 text-slate-500">{sym.description}</span>}
                          </div>
                          <span className={`font-mono font-bold ${sym.score > 0 ? "text-red-400" : sym.score < 0 ? "text-green-400" : "text-slate-500"}`}>
                            {sym.score > 0 ? "+" : ""}{sym.score?.toFixed(2) ?? "0"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Learn */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-400">Learn:</span>
                <LearnButtons logId={detail.id} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
