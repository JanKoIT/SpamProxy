"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  Plus,
  Trash2,
  Loader2,
  Info,
  X,
} from "lucide-react";

interface AccessListEntry {
  id: number;
  list_type: string;
  entry_type: string;
  value: string;
  description: string;
  is_active: boolean;
  created_at: string;
}

const entryTypeOptions = [
  { value: "domain", label: "Domain" },
  { value: "email", label: "E-Mail" },
  { value: "ip", label: "IP-Adresse" },
  { value: "cidr", label: "CIDR-Netzwerk" },
];

const entryTypePlaceholders: Record<string, string> = {
  domain: "example.com",
  email: "user@example.com",
  ip: "192.168.1.1",
  cidr: "10.0.0.0/24",
};

const entryTypeBadgeColors: Record<string, string> = {
  domain: "bg-blue-500/20 text-blue-400",
  email: "bg-purple-500/20 text-purple-400",
  ip: "bg-green-500/20 text-green-400",
  cidr: "bg-yellow-500/20 text-yellow-400",
};

export default function AccessListsPage() {
  const [entries, setEntries] = useState<AccessListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"whitelist" | "blacklist">("whitelist");
  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formEntryType, setFormEntryType] = useState("domain");
  const [formValue, setFormValue] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/access-lists?list_type=${activeTab}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Eintraege");
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function handleAdd() {
    if (!formValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/access-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_type: activeTab,
          entry_type: formEntryType,
          value: formValue.trim(),
          description: formDescription.trim(),
        }),
      });
      if (!res.ok) throw new Error("Fehler beim Hinzufuegen");
      setShowDialog(false);
      setFormEntryType("domain");
      setFormValue("");
      setFormDescription("");
      await loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: number) {
    setTogglingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/access-lists/${id}`, { method: "PUT" });
      if (!res.ok) throw new Error("Fehler beim Umschalten");
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, is_active: !e.is_active } : e))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/access-lists/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim Loeschen");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Whitelist &amp; Blacklist</h1>
          <p className="text-sm text-slate-400">
            Domains, E-Mail-Adressen und IPs erlauben oder blockieren
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab("whitelist")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "whitelist"
              ? "bg-green-600/20 text-green-400 border border-green-500/30"
              : "bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200"
          }`}
        >
          Whitelist
        </button>
        <button
          onClick={() => setActiveTab("blacklist")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "blacklist"
              ? "bg-red-600/20 text-red-400 border border-red-500/30"
              : "bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200"
          }`}
        >
          Blacklist
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowDialog(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Eintrag hinzufuegen
        </button>
      </div>

      {/* Info banner */}
      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
          activeTab === "whitelist"
            ? "border-green-500/30 bg-green-500/10 text-green-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
        }`}
      >
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        {activeTab === "whitelist"
          ? "Eintraege auf der Whitelist umgehen den Spam-Filter und werden immer zugestellt."
          : "Eintraege auf der Blacklist werden immer abgelehnt."}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-sm text-slate-500">
          Keine Eintraege vorhanden
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Aktiv</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Typ</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Wert</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Beschreibung</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-slate-800/50 bg-slate-900 hover:bg-slate-800/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(entry.id)}
                      disabled={togglingId === entry.id}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                        entry.is_active ? "bg-blue-600" : "bg-slate-700"
                      } ${togglingId === entry.id ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          entry.is_active ? "translate-x-4.5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        entryTypeBadgeColors[entry.entry_type] ?? "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {entryTypeOptions.find((o) => o.value === entry.entry_type)?.label ?? entry.entry_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-white">{entry.value}</td>
                  <td className="px-4 py-3 text-slate-400">{entry.description || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmDeleteId === entry.id ? (
                      <div className="inline-flex items-center gap-2">
                        <span className="text-xs text-slate-400">Wirklich loeschen?</span>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          disabled={deletingId === entry.id}
                          className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {deletingId === entry.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Ja"
                          )}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
                        >
                          Nein
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(entry.id)}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                        title="Loeschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Eintrag hinzufuegen</h2>
              <button
                onClick={() => setShowDialog(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* List Type (read-only, from active tab) */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Liste</label>
                <div
                  className={`rounded-md border px-3 py-2 text-sm ${
                    activeTab === "whitelist"
                      ? "border-green-500/30 bg-green-500/10 text-green-400"
                      : "border-red-500/30 bg-red-500/10 text-red-400"
                  }`}
                >
                  {activeTab === "whitelist" ? "Whitelist" : "Blacklist"}
                </div>
              </div>

              {/* Entry Type */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Typ</label>
                <select
                  value={formEntryType}
                  onChange={(e) => setFormEntryType(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {entryTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Value */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Wert</label>
                <input
                  type="text"
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  placeholder={entryTypePlaceholders[formEntryType] ?? ""}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Beschreibung <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Optionale Beschreibung"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDialog(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleAdd}
                disabled={saving || !formValue.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Hinzufuegen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
