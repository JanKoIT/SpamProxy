"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, Search, RefreshCw, Loader2 } from "lucide-react";

interface LogResponse {
  lines: string[];
  total: number;
}

const LINE_OPTIONS = [100, 200, 500, 1000];

function classifyLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("reject") || lower.includes("error")) return "text-red-400";
  if (lower.includes("warning")) return "text-yellow-400";
  if (lower.includes("connect from")) return "text-green-400";
  if (lower.includes("disconnect")) return "text-slate-500";
  return "text-slate-300";
}

export default function PostfixLogPage() {
  const [lines, setLines] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [lineCount, setLineCount] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lines: lineCount.toString(),
        search,
      });
      const res = await fetch(`/api/postfix-log?${params}`);
      const data: LogResponse = await res.json();
      setLines(data.lines);
      setTotal(data.total);
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [lineCount, search]);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Scroll to bottom when lines change
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="flex flex-col h-full gap-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Terminal className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Postfix Log</h1>
        <span className="ml-auto text-sm text-slate-400">
          {total.toLocaleString()} total lines
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Filter log lines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchLogs()}
            className="w-full pl-10 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Lines selector */}
        <select
          value={lineCount}
          onChange={(e) => setLineCount(Number(e.target.value))}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {LINE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} lines
            </option>
          ))}
        </select>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh((prev) => !prev)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            autoRefresh
              ? "bg-green-600/20 text-green-400 border border-green-600/50"
              : "bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200"
          }`}
        >
          {autoRefresh ? "Auto: ON" : "Auto: OFF"}
        </button>

        {/* Refresh button */}
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </button>
      </div>

      {/* Log display */}
      <div
        ref={logRef}
        className="flex-1 min-h-0 overflow-auto bg-slate-950 rounded-lg border border-slate-700/50 p-4 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && !loading && (
          <div className="text-slate-500 text-center py-8">
            No log lines found.
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${classifyLine(line)}`}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
