"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ListChecks, ArrowLeft, Plus, Trash2, Loader2, ShieldCheck, ShieldX } from "lucide-react";

type Entry = {
  id: string;
  list_type: "whitelist" | "blacklist";
  entry_type: "email" | "domain";
  value: string;
  is_active: boolean;
  created_at: string | null;
};

export default function PortalAccessLists() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newValue, setNewValue] = useState("");
  const [newListType, setNewListType] = useState<"whitelist" | "blacklist">("whitelist");
  const [newEntryType, setNewEntryType] = useState<"email" | "domain">("email");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/portal/access-list");
    if (res.status === 401) {
      router.replace("/portal");
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries ?? []);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { reload(); }, [reload]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/portal/access-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_type: newListType,
          entry_type: newEntryType,
          value: newValue.trim(),
        }),
      });
      setNewValue("");
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Eintrag entfernen?")) return;
    await fetch(`/api/portal/access-list/${id}`, { method: "DELETE" });
    await reload();
  }

  const whitelist = entries.filter((e) => e.list_type === "whitelist");
  const blacklist = entries.filter((e) => e.list_type === "blacklist");

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListChecks className="h-7 w-7 text-blue-400" />
          <h1 className="text-xl font-bold">Whitelist &amp; Blacklist</h1>
        </div>
        <Link
          href="/portal/quarantine"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Zur Quarantäne
        </Link>
      </header>

      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-white">Neuer Eintrag</h2>
        <form onSubmit={addEntry} className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_140px_1fr_auto]">
          <select
            value={newListType}
            onChange={(e) => setNewListType(e.target.value as "whitelist" | "blacklist")}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          >
            <option value="whitelist">Whitelist</option>
            <option value="blacklist">Blacklist</option>
          </select>
          <select
            value={newEntryType}
            onChange={(e) => setNewEntryType(e.target.value as "email" | "domain")}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          >
            <option value="email">E-Mail-Adresse</option>
            <option value="domain">Domain</option>
          </select>
          <input
            type="text"
            required
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={newEntryType === "email" ? "sender@beispiel.de" : "beispiel.de"}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
          />
          <button
            type="submit"
            disabled={saving || !newValue.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Hinzufügen
          </button>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Whitelist-Einträge werden ohne Prüfung an Ihr Postfach zugestellt.
          Blacklist-Einträge werden immer als Spam markiert.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ListBox
            title="Whitelist"
            icon={<ShieldCheck className="h-5 w-5 text-green-400" />}
            entries={whitelist}
            onRemove={remove}
            emptyText="Noch keine Whitelist-Einträge."
          />
          <ListBox
            title="Blacklist"
            icon={<ShieldX className="h-5 w-5 text-red-400" />}
            entries={blacklist}
            onRemove={remove}
            emptyText="Noch keine Blacklist-Einträge."
          />
        </div>
      )}
    </div>
  );
}

function ListBox({ title, icon, entries, onRemove, emptyText }: {
  title: string;
  icon: React.ReactNode;
  entries: Entry[];
  onRemove: (id: string) => void;
  emptyText: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-800 p-4">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="ml-auto text-xs text-slate-500">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm text-white">{e.value}</div>
                <div className="text-xs text-slate-500">
                  {e.entry_type === "email" ? "E-Mail" : "Domain"}
                </div>
              </div>
              <button
                onClick={() => onRemove(e.id)}
                title="Entfernen"
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-600/20 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
