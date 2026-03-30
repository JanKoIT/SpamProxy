export const dynamic = "force-dynamic";

import { fetchQuarantineItem } from "@/lib/api";
import { notFound } from "next/navigation";
import Link from "next/link";
import { QuarantineDetailActions } from "@/components/quarantine/quarantine-detail-actions";
import { ArrowLeft, Mail, Shield, Clock } from "lucide-react";

export default async function QuarantineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let item;
  try {
    item = await fetchQuarantineItem(id);
  } catch {
    notFound();
  }

  const headers = item.parsed_headers ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/quarantine"
            className="rounded-md border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold text-white">Message Details</h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              item.status === "pending"
                ? "bg-yellow-900/30 text-yellow-400"
                : item.status === "approved"
                  ? "bg-green-900/30 text-green-400"
                  : "bg-red-900/30 text-red-400"
            }`}
          >
            {item.status}
          </span>
        </div>

        {item.status === "pending" && <QuarantineDetailActions id={item.id} />}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
            <Mail className="h-4 w-4" />
            Envelope
          </div>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">From</dt>
              <dd className="text-white">{item.mail_from || "(unknown)"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">To</dt>
              <dd className="text-white">
                {item.rcpt_to.length > 0 ? item.rcpt_to.join(", ") : "(unknown)"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Subject</dt>
              <dd className="text-white">{item.subject || "(no subject)"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
            <Shield className="h-4 w-4" />
            Spam Scores
          </div>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Rspamd Score</dt>
              <dd className={`font-mono font-semibold ${scoreColor(item.rspamd_score)}`}>
                {item.rspamd_score !== null ? item.rspamd_score.toFixed(2) : "N/A"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Final Score</dt>
              <dd className={`font-mono font-semibold ${scoreColor(item.final_score)}`}>
                {item.final_score !== null ? item.final_score.toFixed(2) : "N/A"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
            <Clock className="h-4 w-4" />
            Timing
          </div>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Received</dt>
              <dd className="text-white">
                {new Date(item.created_at).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">ID</dt>
              <dd className="break-all font-mono text-xs text-slate-400">{item.id}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Headers table */}
      {Object.keys(headers).length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Parsed Headers</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Header</th>
                  <th className="px-4 py-2">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {Object.entries(headers).map(([key, value]) => (
                  <tr key={key} className="hover:bg-slate-800/50 transition-colors">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-blue-400">
                      {key}
                    </td>
                    <td className="break-all px-4 py-2 text-slate-300">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Body preview */}
      {item.body_preview && (
        <div className="rounded-lg border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Body Preview</h2>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-4 font-mono text-sm text-slate-300">
            {item.body_preview}
          </pre>
        </div>
      )}
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-slate-400";
  if (score < 5) return "text-green-400";
  if (score < 10) return "text-yellow-400";
  return "text-red-400";
}
