"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { QuarantineItem } from "@/lib/api";
import {
  Search,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

interface QuarantineListProps {
  items: QuarantineItem[];
  total: number;
  page: number;
  pageSize: number;
  currentStatus: string;
  currentSearch: string;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-slate-400";
  if (score < 5) return "text-green-400";
  if (score < 10) return "text-yellow-400";
  return "text-red-400";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QuarantineList({
  items,
  total,
  page,
  pageSize,
  currentStatus,
  currentSearch,
}: QuarantineListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(currentSearch);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams({
      status: currentStatus,
      ...params,
    });
    startTransition(() => {
      router.push(`/quarantine?${sp.toString()}`);
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ search, page: "1" });
  }

  async function handleAction(id: string, action: "approve" | "reject") {
    setActionLoading(id);
    try {
      await fetch(`/api/quarantine/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      startTransition(() => router.refresh());
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBulk(action: "approve" | "reject") {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await fetch("/api/quarantine/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      setSelected(new Set());
      startTransition(() => router.refresh());
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by sender, recipient, or subject..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Search
        </button>
      </form>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-slate-800 px-4 py-3">
          <span className="text-sm text-slate-300">
            {selected.size} item{selected.size !== 1 && "s"} selected
          </span>
          <button
            onClick={() => handleBulk("approve")}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            Approve
          </button>
          <button
            onClick={() => handleBulk("reject")}
            disabled={bulkLoading}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Reject
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleAll}
                  className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  No quarantine items found.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className="bg-slate-950 hover:bg-slate-900 transition-colors"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-white">
                    <Link
                      href={`/quarantine/${item.id}`}
                      className="hover:text-blue-400 transition-colors"
                    >
                      {item.mail_from || "(unknown)"}
                    </Link>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-slate-300">
                    {item.rcpt_to[0] || "(unknown)"}
                    {item.rcpt_to.length > 1 && (
                      <span className="ml-1 text-xs text-slate-500">
                        +{item.rcpt_to.length - 1}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[300px] truncate px-4 py-3 text-slate-300">
                    <Link
                      href={`/quarantine/${item.id}`}
                      className="hover:text-blue-400 transition-colors"
                    >
                      {item.subject || "(no subject)"}
                    </Link>
                  </td>
                  <td className={`px-4 py-3 font-mono font-semibold ${scoreColor(item.final_score)}`}>
                    {item.final_score !== null ? item.final_score.toFixed(1) : "---"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {currentStatus === "pending" ? (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleAction(item.id, "approve")}
                          disabled={actionLoading === item.id}
                          title="Approve"
                          className="rounded p-1.5 text-green-400 hover:bg-green-900/30 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleAction(item.id, "reject")}
                          disabled={actionLoading === item.id}
                          title="Reject"
                          className="rounded p-1.5 text-red-400 hover:bg-red-900/30 disabled:opacity-50 transition-colors"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.status === "approved"
                          ? "bg-green-900/30 text-green-400"
                          : "bg-red-900/30 text-red-400"
                      }`}>
                        {item.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Showing {(page - 1) * pageSize + 1}--
            {Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => navigate({ page: String(page - 1), search })}
              disabled={page <= 1 || isPending}
              className="rounded-md border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (page <= 4) {
                p = i + 1;
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = page - 3 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => navigate({ page: String(p), search })}
                  disabled={isPending}
                  className={`min-w-[36px] rounded-md border px-2 py-2 text-sm font-medium transition-colors ${
                    p === page
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => navigate({ page: String(page + 1), search })}
              disabled={page >= totalPages || isPending}
              className="rounded-md border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isPending && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
        </div>
      )}
    </div>
  );
}
