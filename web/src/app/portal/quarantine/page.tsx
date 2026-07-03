"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, CheckCircle, XCircle, Loader2, LogOut, ListChecks, KeyRound } from "lucide-react";

type Item = {
  id: string;
  mail_from: string | null;
  subject: string | null;
  final_score: number | null;
  status: string;
  created_at: string | null;
  body_preview: string | null;
};

type Me = { email: string; name: string | null; has_password: boolean };

const TABS = [
  { label: "In Quarantäne", value: "pending" },
  { label: "Zugestellt", value: "approved" },
  { label: "Verworfen", value: "rejected" },
];

export default function PortalQuarantine() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const pageSize = 50;

  const reload = useCallback(async () => {
    const params = new URLSearchParams({ status, page: String(page), page_size: String(pageSize) });
    const res = await fetch(`/api/portal/quarantine?${params}`);
    if (res.status === 401) {
      router.replace("/portal");
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [status, page, router]);

  useEffect(() => {
    fetch("/api/portal/me").then(async (res) => {
      if (!res.ok) {
        router.replace("/portal");
      } else {
        setMe(await res.json());
      }
    });
  }, [router]);

  useEffect(() => { reload(); }, [reload]);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      await fetch(`/api/portal/quarantine/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.replace("/portal");
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-7 w-7 text-blue-400" />
          <div>
            <h1 className="text-xl font-bold">Ihre Spam-Quarantäne</h1>
            {me && <p className="text-xs text-slate-400">Angemeldet als {me.email}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/portal/access-lists"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            <ListChecks className="h-4 w-4" /> Whitelist &amp; Blacklist
          </Link>
          <Link
            href="/portal/account"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            <KeyRound className="h-4 w-4" /> Konto
          </Link>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" /> Abmelden
          </button>
        </div>
      </header>

      {me && !me.has_password && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-blue-200">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span>
              Sie haben noch kein Passwort. Setzen Sie eins, um sich künftig
              direkt ohne Wartezeit auf die Anmelde-Mail einzuloggen.
            </span>
          </div>
          <Link
            href="/portal/account"
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Passwort setzen
          </Link>
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setStatus(t.value); setPage(1); }}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              status === t.value
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
          Keine Nachrichten in dieser Kategorie.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">
                    {item.subject || "(kein Betreff)"}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-400">
                    <span className="font-mono">{item.mail_from || "(unbekannt)"}</span>
                    {" · "}
                    <span>Score {item.final_score?.toFixed(1) ?? "?"}</span>
                    {" · "}
                    <span>
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString("de-DE")
                        : ""}
                    </span>
                  </div>
                  {item.body_preview && (
                    <div className="mt-2 line-clamp-2 text-xs text-slate-500">
                      {item.body_preview.slice(0, 200)}
                    </div>
                  )}
                </div>
                {status === "pending" && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => act(item.id, "approve")}
                      disabled={busy === item.id}
                      title="Zustellen"
                      className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {busy === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      Zustellen
                    </button>
                    <button
                      onClick={() => act(item.id, "reject")}
                      disabled={busy === item.id}
                      title="Als Spam verwerfen"
                      className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" /> Spam
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-400">
            Seite {page} von {totalPages} · {total} Nachrichten
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 disabled:opacity-40"
            >
              Zurück
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 disabled:opacity-40"
            >
              Weiter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
