export const dynamic = "force-dynamic";

import { fetchLogs } from "@/lib/api";
import { LearnButtons } from "@/components/logs/learn-buttons";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  delivered: "bg-green-500/20 text-green-400 border-green-500/30",
  quarantined: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  error: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? 1);
  const direction = (params.direction as string) ?? "";
  const action = (params.action as string) ?? "";
  const search = (params.search as string) ?? "";
  const pageSize = 50;

  const data = await fetchLogs(page, pageSize, direction, action, search);
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  function buildHref(overrides: Record<string, string | number>) {
    const p: Record<string, string> = {};
    if (direction) p.direction = direction;
    if (action) p.action = action;
    if (search) p.search = search;
    if (page > 1) p.page = String(page);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === "" || v === "all") {
        delete p[k];
      } else {
        p[k] = String(v);
      }
    }
    const qs = new URLSearchParams(p).toString();
    return `/logs${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Mail Log</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg bg-slate-900 p-4">
        {/* Search */}
        <form className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="action" value={action} />
          <input
            name="search"
            defaultValue={search}
            placeholder="Search sender, recipient, subject..."
            className="w-full rounded-md border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>

        {/* Direction filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Direction:</span>
          <div className="flex rounded-md border border-slate-700 bg-slate-800">
            {[
              { label: "All", value: "" },
              { label: "Inbound", value: "inbound" },
              { label: "Outbound", value: "outbound" },
            ].map((opt) => (
              <a
                key={opt.value}
                href={buildHref({ direction: opt.value, page: 1 })}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  direction === opt.value
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-700"
                } first:rounded-l-md last:rounded-r-md`}
              >
                {opt.label}
              </a>
            ))}
          </div>
        </div>

        {/* Action filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Action:</span>
          <div className="flex rounded-md border border-slate-700 bg-slate-800">
            {[
              { label: "All", value: "" },
              { label: "Delivered", value: "delivered" },
              { label: "Quarantined", value: "quarantined" },
              { label: "Rejected", value: "rejected" },
            ].map((opt) => (
              <a
                key={opt.value}
                href={buildHref({ action: opt.value, page: 1 })}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  action === opt.value
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-700"
                } first:rounded-l-md last:rounded-r-md`}
              >
                {opt.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Direction</th>
              <th className="px-4 py-3 font-medium">From</th>
              <th className="px-4 py-3 font-medium">To</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium text-right">Score</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Client IP</th>
              <th className="px-4 py-3 font-medium">Learn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {data.items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  No log entries found.
                </td>
              </tr>
            )}
            {data.items.map((log) => (
              <tr key={log.id} className="hover:bg-slate-800/60 transition-colors">
                <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                  {formatDate(log.created_at)}
                </td>
                <td className="px-4 py-3">
                  {log.direction === "inbound" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400 border border-blue-500/30">
                      <ArrowDownLeft className="h-3 w-3" />
                      In
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400 border border-purple-500/30">
                      <ArrowUpRight className="h-3 w-3" />
                      Out
                    </span>
                  )}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-slate-300">
                  {log.mail_from ?? "-"}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-slate-300">
                  {log.rcpt_to.join(", ") || "-"}
                </td>
                <td className="max-w-[250px] truncate px-4 py-3 text-white">
                  {log.subject ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-slate-300">
                  {log.final_score != null ? log.final_score.toFixed(1) : "-"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                      ACTION_COLORS[log.action] ?? "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {log.action}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-400">
                  {log.client_ip ?? "-"}
                </td>
                <td className="px-4 py-3">
                  <LearnButtons logId={log.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-slate-400">
        <p>
          Showing {(page - 1) * pageSize + 1}&ndash;
          {Math.min(page * pageSize, data.total)} of {data.total} entries
        </p>
        <div className="flex items-center gap-1">
          <a
            href={buildHref({ page: page - 1 })}
            aria-disabled={page <= 1}
            className={`rounded-md p-2 ${
              page <= 1
                ? "pointer-events-none text-slate-600"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <ChevronLeft className="h-4 w-4" />
          </a>
          <span className="px-3 text-white">
            {page} / {totalPages}
          </span>
          <a
            href={buildHref({ page: page + 1 })}
            aria-disabled={page >= totalPages}
            className={`rounded-md p-2 ${
              page >= totalPages
                ? "pointer-events-none text-slate-600"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <ChevronRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
