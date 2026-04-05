"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  RefreshCw,
  Loader2,
  Search,
  Eye,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  Server,
} from "lucide-react";

interface ScanRow {
  id: string;
  ip: string;
  sender_mime: string;
  rcpt_mime: string;
  subject: string;
  action: string;
  score: number;
  required_score: number;
  symbols: Record<string, { score: number; options?: string[] }>;
  size: number;
  scan_time: number;
  unix_time: number;
  message_id: string;
  user: string;
}

const ACTION_COLORS: Record<string, string> = {
  "no action": "bg-green-500/20 text-green-400 border-green-500/30",
  "add header": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  reject: "bg-red-500/20 text-red-400 border-red-500/30",
  "soft reject": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  greylist: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${day}.${mon} ${h}:${m}:${s}`;
}

export default function ScanHistoryPage() {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [detail, setDetail] = useState<ScanRow | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/scan-history");
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchHistory, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHistory]);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.sender_mime?.toLowerCase().includes(q) ||
      r.rcpt_mime?.toLowerCase().includes(q) ||
      r.subject?.toLowerCase().includes(q) ||
      r.ip?.includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Scan History</h1>
            <p className="text-sm text-slate-400">
              All rspamd scans including remote scanner clients
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500" />
            Auto-refresh
          </label>
          <button onClick={fetchHistory} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-300">
        Shows all mails scanned by this rspamd instance — including mails from remote scanner clients.
        Use this to monitor scanning across all connected mail servers.
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sender, recipient, subject, IP..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg bg-slate-800 p-3">
          <p className="text-xs text-slate-400">Total Scans</p>
          <p className="text-xl font-bold text-white">{rows.length}</p>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <p className="text-xs text-green-400">Clean</p>
          <p className="text-xl font-bold text-green-400">
            {rows.filter((r) => r.action === "no action").length}
          </p>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <p className="text-xs text-yellow-400">Header Added</p>
          <p className="text-xl font-bold text-yellow-400">
            {rows.filter((r) => r.action === "add header").length}
          </p>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <p className="text-xs text-red-400">Rejected/Greylisted</p>
          <p className="text-xl font-bold text-red-400">
            {rows.filter((r) => r.action === "reject" || r.action === "soft reject" || r.action === "greylist").length}
          </p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /></div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-400">
                <th className="px-3 py-2.5 font-medium">Time</th>
                <th className="px-3 py-2.5 font-medium">IP</th>
                <th className="px-3 py-2.5 font-medium">From</th>
                <th className="px-3 py-2.5 font-medium">To</th>
                <th className="px-3 py-2.5 font-medium">Subject</th>
                <th className="px-3 py-2.5 font-medium text-right">Score</th>
                <th className="px-3 py-2.5 font-medium">Action</th>
                <th className="px-3 py-2.5 font-medium">Scan</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  {rows.length === 0 ? "No scan history yet. History fills up as mails are scanned." : "No matches found."}
                </td></tr>
              )}
              {filtered.map((row, i) => (
                <tr key={row.id || i} className="hover:bg-slate-800/60 transition-colors">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                    {formatTime(row.unix_time)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.ip || "-"}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">{row.sender_mime || "-"}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">{row.rcpt_mime || "-"}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-xs text-white" title={row.subject}>
                    {row.subject || "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs">
                    <span className={row.score >= 5 ? "text-red-400" : row.score >= 3 ? "text-yellow-400" : "text-green-400"}>
                      {row.score?.toFixed(1) ?? "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                      ACTION_COLORS[row.action] ?? "bg-slate-700 text-slate-300"
                    }`}>
                      {row.action}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                    {row.scan_time ? `${row.scan_time.toFixed(0)}ms` : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => setDetail(row)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white transition-colors" title="Details">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Scan Details</h2>
              <button onClick={() => setDetail(null)} className="rounded-md p-1 text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">From:</span> <span className="text-white break-all">{detail.sender_mime || "-"}</span></div>
                <div><span className="text-slate-500">To:</span> <span className="text-white break-all">{detail.rcpt_mime || "-"}</span></div>
                <div><span className="text-slate-500">Subject:</span> <span className="text-white break-all">{detail.subject || "-"}</span></div>
                <div><span className="text-slate-500">Time:</span> <span className="text-white">{formatTime(detail.unix_time)}</span></div>
                <div><span className="text-slate-500">Client IP:</span> <span className="text-white font-mono">{detail.ip || "-"}</span></div>
                <div><span className="text-slate-500">Size:</span> <span className="text-white">{detail.size ? `${(detail.size / 1024).toFixed(1)} KB` : "-"}</span></div>
                <div><span className="text-slate-500">Scan Time:</span> <span className="text-white">{detail.scan_time?.toFixed(0) ?? "-"} ms</span></div>
                <div><span className="text-slate-500">Message-ID:</span> <span className="text-white font-mono text-xs break-all">{detail.message_id || "-"}</span></div>
              </div>

              <div className="rounded-lg bg-slate-800 p-4">
                <h3 className="text-sm font-semibold text-white mb-2">Score: {detail.score?.toFixed(2)} / {detail.required_score?.toFixed(2)}</h3>
                <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[detail.action] ?? ""}`}>
                  {detail.action}
                </span>
              </div>

              {detail.symbols && Object.keys(detail.symbols).length > 0 && (
                <div className="rounded-lg bg-slate-800 p-4">
                  <h3 className="text-sm font-semibold text-white mb-2">Symbols</h3>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {Object.entries(detail.symbols)
                      .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0))
                      .map(([name, sym]) => (
                        <div key={name} className="flex items-center justify-between text-xs py-1 border-b border-slate-700/50">
                          <span className="font-mono text-white">{name}</span>
                          <span className={`font-mono font-bold ${sym.score > 0 ? "text-red-400" : sym.score < 0 ? "text-green-400" : "text-slate-500"}`}>
                            {sym.score > 0 ? "+" : ""}{sym.score?.toFixed(2) ?? "0"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
