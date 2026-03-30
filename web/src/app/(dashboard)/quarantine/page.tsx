export const dynamic = "force-dynamic";

import { fetchQuarantine } from "@/lib/api";
import { QuarantineList } from "@/components/quarantine/quarantine-list";
import Link from "next/link";

const TABS = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
] as const;

export default async function QuarantinePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; search?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status || "pending";
  const search = params.search || "";

  const data = await fetchQuarantine(page, 20, status, search);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Quarantine</h1>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={{
              pathname: "/quarantine",
              query: {
                status: tab.value,
                ...(search ? { search } : {}),
              },
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              status === tab.value
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <QuarantineList
        items={data.items}
        total={data.total}
        page={data.page}
        pageSize={data.page_size}
        currentStatus={status}
        currentSearch={search}
      />
    </div>
  );
}
