"use client";

import { useCallback, useEffect, useState } from "react";
import { UserCheck, Plus, Trash2, Send, Loader2, X, KeyRound } from "lucide-react";

type Recipient = {
  id: string;
  email: string;
  name: string | null;
  daily_report_enabled: boolean;
  has_password: boolean;
  language: string;
  last_report_sent_at: string | null;
  created_at: string | null;
};

export default function RecipientsPage() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<Recipient | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/recipients", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRecipients(data.recipients ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function addRecipient() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, name: newName || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || "Fehler beim Anlegen");
      }
      setNewEmail("");
      setNewName("");
      setShowAdd(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(r: Recipient) {
    await fetch(`/api/recipients/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_report_enabled: !r.daily_report_enabled }),
    });
    await reload();
  }

  async function sendNow(r: Recipient) {
    const res = await fetch(`/api/recipients/${r.id}/send-now`, { method: "POST" });
    const data = await res.json();
    alert(`${data.sent ?? 0} Nachrichten im Report enthalten.`);
    await reload();
  }

  async function remove(r: Recipient) {
    if (!confirm(`Empfänger ${r.email} entfernen?`)) return;
    await fetch(`/api/recipients/${r.id}`, { method: "DELETE" });
    await reload();
  }

  async function savePassword() {
    if (!passwordFor) return;
    setPwSaving(true);
    try {
      const res = await fetch(`/api/recipients/${passwordFor.id}/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwValue || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.detail || "Fehler beim Speichern");
        return;
      }
      setPasswordFor(null);
      setPwValue("");
      await reload();
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCheck className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Quarantine Recipients</h1>
            <p className="text-sm text-slate-400">
              End-Benutzer, die täglich einen Spam-Quarantäne-Report bekommen
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Empfänger hinzufügen
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-white">Neuer Empfänger</h3>
            <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="email"
              placeholder="E-Mail-Adresse"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
            <input
              type="text"
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </div>
          <button
            onClick={addRecipient}
            disabled={saving || !newEmail.includes("@")}
            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Speichere..." : "Anlegen"}
          </button>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/50 text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left font-medium">E-Mail</th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Daily Report</th>
              <th className="px-4 py-3 text-left font-medium">Letzter Report</th>
              <th className="px-4 py-3 text-right font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {recipients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Noch keine Empfänger angelegt.
                </td>
              </tr>
            )}
            {recipients.map((r) => (
              <tr key={r.id} className="text-slate-200">
                <td className="px-4 py-3 font-mono text-xs">{r.email}</td>
                <td className="px-4 py-3">{r.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleEnabled(r)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      r.daily_report_enabled ? "bg-blue-600" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                        r.daily_report_enabled ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {r.last_report_sent_at
                    ? new Date(r.last_report_sent_at).toLocaleString("de-DE")
                    : "noch nie"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => { setPasswordFor(r); setPwValue(""); }}
                    className={`mr-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                      r.has_password
                        ? "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40"
                        : "bg-slate-600/20 text-slate-300 hover:bg-slate-600/40"
                    }`}
                    title={r.has_password ? "Passwort ändern / entfernen" : "Passwort setzen"}
                  >
                    <KeyRound className="h-3 w-3" /> {r.has_password ? "Passwort" : "Kein Passwort"}
                  </button>
                  <button
                    onClick={() => sendNow(r)}
                    className="mr-2 inline-flex items-center gap-1 rounded-md bg-blue-600/20 px-2 py-1 text-xs text-blue-300 hover:bg-blue-600/40"
                    title="Report jetzt senden"
                  >
                    <Send className="h-3 w-3" /> Senden
                  </button>
                  <button
                    onClick={() => remove(r)}
                    className="inline-flex items-center gap-1 rounded-md bg-red-600/20 px-2 py-1 text-xs text-red-300 hover:bg-red-600/40"
                  >
                    <Trash2 className="h-3 w-3" /> Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Password modal */}
      {passwordFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Passwort für {passwordFor.email}
              </h3>
              <button
                type="button"
                onClick={() => { setPasswordFor(null); setPwValue(""); }}
                title="Schließen"
                aria-label="Schließen"
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              {passwordFor.has_password
                ? "Neues Passwort setzen oder Feld leer lassen und speichern, um das Passwort zu entfernen (dann nur Magic-Link-Login)."
                : "Neues Passwort setzen. Mindestens 8 Zeichen. Feld leer lassen bedeutet Magic-Link-Only."}
            </p>
            <input
              type="password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              placeholder="Neues Passwort (min. 8 Zeichen)"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setPasswordFor(null); setPwValue(""); }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                Abbrechen
              </button>
              <button
                onClick={savePassword}
                disabled={pwSaving || (pwValue.length > 0 && pwValue.length < 8)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pwSaving ? "Speichere..." : "Speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
