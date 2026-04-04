"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Inbox,
  RefreshCw,
  Loader2,
  Send,
  Trash2,
  Pause,
  Play,
  AlertTriangle,
  Clock,
  Mail,
} from "lucide-react";

interface Recipient {
  address: string;
  delay_reason: string;
}

interface QueueItem {
  queue_id: string;
  queue_name: string;
  arrival_time: number;
  message_size: number;
  sender: string;
  recipients: Recipient[];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const queueColors: Record<string, string> = {
  deferred: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  active: "border-green-500/30 bg-green-500/10 text-green-400",
  hold: "border-red-500/30 bg-red-500/10 text-red-400",
  incoming: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  maildrop: "border-slate-500/30 bg-slate-500/10 text-slate-400",
};

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        if (data.error) setError(data.error);
        else setError(null);
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchQueue, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchQueue]);

  async function handleAction(queueId: string, action: string) {
    setActionLoading(`${queueId}-${action}`);
    try {
      await fetch(`/api/queue/${queueId}/${action}`, { method: "POST" });
      await fetchQueue();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFlush() {
    setActionLoading("flush");
    try {
      await fetch("/api/queue/flush", { method: "POST" });
      await fetchQueue();
    } finally {
      setActionLoading(null);
    }
  }

  const deferred = items.filter((i) => i.queue_name === "deferred");
  const active = items.filter((i) => i.queue_name === "active");
  const held = items.filter((i) => i.queue_name === "hold");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Mail Queue</h1>
            <p className="text-sm text-slate-400">
              Postfix mail queue - deferred and pending messages
            </p>
          </div>
        </div>
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
          <button
            onClick={fetchQueue}
            disabled={loading}
            className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleFlush}
            disabled={actionLoading === "flush" || items.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {actionLoading === "flush" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Flush Queue
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg bg-slate-800 p-4">
          <p className="text-xs text-slate-400">Total</p>
          <p className="text-2xl font-bold text-white">{items.length}</p>
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <p className="text-xs text-yellow-400">Deferred</p>
          <p className="text-2xl font-bold text-yellow-400">{deferred.length}</p>
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <p className="text-xs text-green-400">Active</p>
          <p className="text-2xl font-bold text-green-400">{active.length}</p>
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <p className="text-xs text-red-400">Held</p>
          <p className="text-2xl font-bold text-red-400">{held.length}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Queue Items */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
          <Mail className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">Queue is empty</h3>
          <p className="mt-2 text-sm text-slate-400">
            All messages have been delivered successfully.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.queue_id}
              className="rounded-lg border border-slate-800 bg-slate-900 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <code className="text-sm font-mono text-white">
                      {item.queue_id}
                    </code>
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                        queueColors[item.queue_name] ?? queueColors.maildrop
                      }`}
                    >
                      {item.queue_name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatSize(item.message_size)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-slate-500">From: </span>
                      <span className="text-slate-300">{item.sender || "(empty)"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-500">
                      <Clock className="h-3 w-3" />
                      {formatTime(item.arrival_time)}
                      <span className="text-slate-600">({timeAgo(item.arrival_time)})</span>
                    </div>
                  </div>

                  {item.recipients.map((r, i) => (
                    <div key={i} className="mt-2">
                      <div className="text-sm">
                        <span className="text-slate-500">To: </span>
                        <span className="text-white">{r.address}</span>
                      </div>
                      {r.delay_reason && (
                        <div className="mt-1 flex items-start gap-2 rounded bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
                          <span className="break-all">{r.delay_reason}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleAction(item.queue_id, "requeue")}
                    disabled={actionLoading !== null}
                    className="rounded p-1.5 text-green-400/60 hover:bg-green-900/30 hover:text-green-400 disabled:opacity-50 transition-colors"
                    title="Requeue (retry delivery)"
                  >
                    {actionLoading === `${item.queue_id}-requeue` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </button>
                  {item.queue_name === "hold" ? (
                    <button
                      onClick={() => handleAction(item.queue_id, "release")}
                      disabled={actionLoading !== null}
                      className="rounded p-1.5 text-blue-400/60 hover:bg-blue-900/30 hover:text-blue-400 disabled:opacity-50 transition-colors"
                      title="Release from hold"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAction(item.queue_id, "hold")}
                      disabled={actionLoading !== null}
                      className="rounded p-1.5 text-yellow-400/60 hover:bg-yellow-900/30 hover:text-yellow-400 disabled:opacity-50 transition-colors"
                      title="Put on hold"
                    >
                      <Pause className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(item.queue_id, "delete")}
                    disabled={actionLoading !== null}
                    className="rounded p-1.5 text-red-400/60 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50 transition-colors"
                    title="Delete from queue"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delivery Status (Bounces & Deferrals from Postfix log) */}
      <DeliveryStatus />
    </div>
  );
}

/* ---------- Delivery Status Component ---------- */

interface DeliveryItem {
  id: string;
  queue_id: string;
  mail_from: string;
  rcpt_to: string;
  status: string;
  dsn: string;
  relay: string;
  delay_reason: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  sent: "border-green-500/30 bg-green-500/10 text-green-400",
  bounced: "border-red-500/30 bg-red-500/10 text-red-400",
  deferred: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  rejected: "border-red-500/30 bg-red-500/10 text-red-400",
};

function DeliveryStatus() {
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchDelivery = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (search) params.set("search", search);
    params.set("page", String(page));
    params.set("page_size", "20");
    const res = await fetch(`/api/delivery-status?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    }
  }, [statusFilter, search, page]);

  useEffect(() => {
    fetchDelivery();
  }, [fetchDelivery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Delivery Status
          <span className="ml-2 text-sm font-normal text-slate-400">
            (bounces, deferrals from Postfix log)
          </span>
        </h2>
        <button
          onClick={fetchDelivery}
          className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {["", "bounced", "deferred", "sent"].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              statusFilter === s
                ? "bg-blue-600 text-white"
                : "border border-slate-700 text-slate-400 hover:bg-slate-800"
            }`}
          >
            {s || "All"}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search address or error..."
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">From</th>
              <th className="px-4 py-3 text-left">To</th>
              <th className="px-4 py-3 text-left">Relay</th>
              <th className="px-4 py-3 text-left">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No delivery status entries found.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-800/60 transition-colors">
                <td className="whitespace-nowrap px-4 py-3 text-slate-400 text-xs">
                  {new Date(item.created_at).toLocaleString("de-DE", {
                    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                    statusColors[item.status] ?? "text-slate-400"
                  }`}>
                    {item.status}
                  </span>
                  {item.dsn && (
                    <span className="ml-1 text-xs text-slate-500 font-mono">{item.dsn}</span>
                  )}
                </td>
                <td className="max-w-[150px] truncate px-4 py-3 text-slate-300">
                  {item.mail_from || "(bounce)"}
                </td>
                <td className="max-w-[150px] truncate px-4 py-3 text-white">
                  {item.rcpt_to}
                </td>
                <td className="max-w-[150px] truncate px-4 py-3 text-slate-400 font-mono text-xs">
                  {item.relay}
                </td>
                <td className="px-4 py-3">
                  {item.delay_reason && (
                    <div className="flex items-start gap-1 text-xs text-red-300 max-w-[300px]">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-red-400" />
                      <span className="break-all">{item.delay_reason}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>{total} entries</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2 py-1">Page {page}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page * 20 >= total}
              className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
