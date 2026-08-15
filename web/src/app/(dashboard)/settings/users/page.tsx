"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Users as UsersIcon, Plus, Pencil, Trash2, Loader2, X, Shield, Eye,
} from "lucide-react";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface UserForm {
  email: string;
  name: string;
  role: string;
  password: string;
  is_active: boolean;
}

const emptyForm: UserForm = {
  email: "",
  name: "",
  role: "viewer",
  password: "",
  is_active: true,
};

export default function UsersAdminPage() {
  const { data: session } = useSession();
  const currentId = session?.user?.id;
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.ok) setUsers(await res.json());
      else setError("Benutzer konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({ email: u.email, name: u.name, role: u.role, password: "", is_active: u.is_active });
    setError(null);
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const isEdit = editing !== null;
      const url = isEdit ? `/api/users/${editing!.id}` : "/api/users";
      const method = isEdit ? "PUT" : "POST";
      const body: Record<string, unknown> = isEdit
        ? { name: form.name, role: form.role, is_active: form.is_active }
        : { email: form.email, name: form.name, role: form.role, is_active: form.is_active, password: form.password };
      if (form.password) body.password = form.password;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Speichern fehlgeschlagen");
      }
      setModalOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function remove(u: User) {
    if (!confirm(`Benutzer „${u.email}“ wirklich löschen?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Löschen fehlgeschlagen");
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
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
          <UsersIcon className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Benutzer</h1>
            <p className="text-sm text-slate-400">Admin-Konten für das SpamProxy-Webinterface verwalten</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Neuer Benutzer
        </button>
      </div>

      {error && !modalOpen && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3">E-Mail</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Rolle</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-800/50">
                <td className="px-4 py-3 text-slate-200">
                  {u.email}
                  {u.id === currentId && <span className="ml-2 text-xs text-slate-500">(Sie)</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">{u.name}</td>
                <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3">
                  {u.is_active
                    ? <span className="text-emerald-400">aktiv</span>
                    : <span className="text-slate-500">deaktiviert</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      title="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(u)}
                      disabled={u.id === currentId}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={u.id === currentId ? "Sie können sich nicht selbst löschen" : "Löschen"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {editing ? "Benutzer bearbeiten" : "Neuer Benutzer"}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <Field label="E-Mail">
                <input
                  type="email"
                  value={form.email}
                  disabled={editing !== null}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="benutzer@beispiel.de"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50"
                />
              </Field>
              <Field label="Name">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Vor- und Nachname"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                />
              </Field>
              <Field label="Rolle">
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                >
                  <option value="admin">Administrator (Vollzugriff)</option>
                  <option value="viewer">Betrachter (nur Lesen)</option>
                </select>
              </Field>
              <Field label={editing ? "Neues Passwort (leer = unverändert)" : "Passwort"}>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="mindestens 8 Zeichen"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                />
              </Field>
              <label className="flex items-center gap-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="h-4 w-4 accent-blue-600"
                />
                Konto aktiv
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-2 py-0.5 text-xs text-blue-400">
        <Shield className="h-3 w-3" /> Administrator
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-500/15 px-2 py-0.5 text-xs text-slate-300">
      <Eye className="h-3 w-3" /> Betrachter
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  );
}
