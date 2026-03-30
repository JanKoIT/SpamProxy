"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Loader2,
  Shield,
} from "lucide-react";

interface RblList {
  id: string;
  name: string;
  rbl_host: string;
  list_type: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface RblForm {
  name: string;
  rbl_host: string;
  list_type: string;
  description: string;
}

const emptyForm: RblForm = {
  name: "",
  rbl_host: "",
  list_type: "ip",
  description: "",
};

export default function BlocklistsPage() {
  const [lists, setLists] = useState<RblList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RblForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rbl");
      if (!res.ok) throw new Error("Fehler beim Laden");
      setLists(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditId(null);
    setForm(emptyForm);
    setShowDialog(true);
    setError(null);
  }

  function openEdit(r: RblList) {
    setEditId(r.id);
    setForm({
      name: r.name,
      rbl_host: r.rbl_host,
      list_type: r.list_type,
      description: r.description ?? "",
    });
    setShowDialog(true);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        rbl_host: form.rbl_host,
        list_type: form.list_type,
        description: form.description || null,
        is_active: true,
      };

      if (editId) {
        const res = await fetch(`/api/rbl/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Fehler beim Aktualisieren");
      } else {
        const res = await fetch("/api/rbl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Fehler beim Erstellen");
      }

      setShowDialog(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/rbl/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle: true }),
      });
      if (!res.ok) throw new Error("Fehler beim Umschalten");
      setLists((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, is_active: !r.is_active } : r
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/rbl/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim L\u00f6schen");
      setDeleteConfirm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    }
  }

  const typeLabels: Record<string, string> = {
    ip: "IP-basiert",
    domain: "Domain-basiert",
    url: "URL-basiert",
  };

  const typeColors: Record<string, string> = {
    ip: "border-blue-500/30 bg-blue-500/20 text-blue-400",
    domain: "border-purple-500/30 bg-purple-500/20 text-purple-400",
    url: "border-yellow-500/30 bg-yellow-500/20 text-yellow-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-yellow-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">DNS Blocklists</h1>
            <p className="text-sm text-slate-400">
              RBL/DNSBL-Listen f&uuml;r Spam-Erkennung verwalten
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Blocklist hinzuf&uuml;gen
        </button>
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
        <strong>Hinweis:</strong> Aktive Blocklists werden von rspamd bei jeder
        eingehenden Mail abgefragt. Der Score wird erh&ouml;ht wenn die
        Absender-IP oder -Domain auf einer Blocklist steht.
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="px-4 py-3 font-medium">Aktiv</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Host</th>
              <th className="px-4 py-3 font-medium">Typ</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && lists.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                  Keine Blocklists konfiguriert.
                </td>
              </tr>
            )}
            {lists.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/60 transition-colors">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => handleToggle(r.id)}
                    disabled={togglingId === r.id}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      r.is_active ? "bg-green-600" : "bg-slate-700"
                    } ${togglingId === r.id ? "opacity-50" : ""}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        r.is_active ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-yellow-400" />
                    <div>
                      <span className="font-medium text-white">{r.name}</span>
                      {r.description && (
                        <p className="text-xs text-slate-500">{r.description}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-slate-300">
                  {r.rbl_host}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                      typeColors[r.list_type] ?? "border-slate-600 bg-slate-700/50 text-slate-400"
                    }`}
                  >
                    {typeLabels[r.list_type] ?? r.list_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {deleteConfirm === r.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          className="rounded-md p-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Best\u00e4tigen"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(null)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 transition-colors"
                          title="Abbrechen"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(r.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        title="L\u00f6schen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {editId ? "Blocklist bearbeiten" : "Neue Blocklist"}
              </h2>
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-md p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="z.B. Spamhaus ZEN"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  RBL Host
                </label>
                <input
                  value={form.rbl_host}
                  onChange={(e) => setForm({ ...form, rbl_host: e.target.value })}
                  placeholder="z.B. zen.spamhaus.org"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Typ
                </label>
                <select
                  value={form.list_type}
                  onChange={(e) => setForm({ ...form, list_type: e.target.value })}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ip">IP-basiert</option>
                  <option value="domain">Domain-basiert</option>
                  <option value="url">URL-basiert</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Beschreibung
                </label>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.name || !form.rbl_host}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editId ? "Speichern" : "Erstellen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
