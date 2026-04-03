"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Loader2,
  Key,
  Mail,
  Eye,
  EyeOff,
} from "lucide-react";

interface SmtpCredential {
  id: string;
  username: string;
  display_name: string | null;
  allowed_from: string[];
  is_active: boolean;
  max_messages_per_hour: number;
  created_at: string;
}

interface CredentialForm {
  username: string;
  password: string;
  display_name: string;
  allowed_from: string;
  is_active: boolean;
  max_messages_per_hour: number;
}

const emptyForm: CredentialForm = {
  username: "",
  password: "",
  display_name: "",
  allowed_from: "",
  is_active: true,
  max_messages_per_hour: 100,
};

export default function SmtpCredentialsPage() {
  const [credentials, setCredentials] = useState<SmtpCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CredentialForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/smtp-credentials");
      if (!res.ok) throw new Error("Failed to fetch credentials");
      setCredentials(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
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
    setShowPassword(false);
    setError(null);
  }

  function openEdit(c: SmtpCredential) {
    setEditId(c.id);
    setForm({
      username: c.username,
      password: "",
      display_name: c.display_name ?? "",
      allowed_from: (c.allowed_from || []).join(", "),
      is_active: c.is_active,
      max_messages_per_hour: c.max_messages_per_hour,
    });
    setShowDialog(true);
    setShowPassword(false);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        username: form.username,
        display_name: form.display_name || null,
        allowed_from: form.allowed_from
          ? form.allowed_from.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        is_active: form.is_active,
        max_messages_per_hour: form.max_messages_per_hour,
      };

      if (form.password) {
        body.password = form.password;
      }

      if (editId) {
        const res = await fetch(`/api/smtp-credentials/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to update credential");
      } else {
        if (!form.password) {
          setError("Password is required");
          setSaving(false);
          return;
        }
        const res = await fetch("/api/smtp-credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to create credential");
      }

      setShowDialog(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/smtp-credentials/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete credential");
      setDeleteConfirm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Outgoing SMTP Auth</h1>
          <p className="mt-1 text-sm text-slate-400">
            Credentials for authenticated mail delivery via port 587
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Credential
        </button>
      </div>

      {/* Info Banner */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
        <strong>SMTP Relay:</strong> Users authenticate with these
        Credentials on port 587 (STARTTLS) for sending outgoing mail.
        Outgoing mail is also scanned by rspamd.
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Credentials Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Allowed Senders</th>
              <th className="px-4 py-3 font-medium">Limit/h</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && credentials.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  No SMTP credentials configured yet.
                </td>
              </tr>
            )}
            {credentials.map((c) => (
              <tr key={c.id} className="hover:bg-slate-800/60 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-blue-400" />
                    <span className="font-mono font-medium text-white">
                      {c.username}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {c.display_name || "\u2014"}
                </td>
                <td className="px-4 py-3">
                  {c.allowed_from && c.allowed_from.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {c.allowed_from.map((addr) => (
                        <span
                          key={addr}
                          className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                        >
                          <Mail className="h-3 w-3" />
                          {addr}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-500">All</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-slate-300">
                  {c.max_messages_per_hour}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                      c.is_active
                        ? "border-green-500/30 bg-green-500/20 text-green-400"
                        : "border-slate-600 bg-slate-700/50 text-slate-400"
                    }`}
                  >
                    {c.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {deleteConfirm === c.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          className="rounded-md p-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="L&ouml;schen best&auml;tigen"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(null)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 transition-colors"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(c.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        title="L&ouml;schen"
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
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {editId ? "Edit Credential" : "New Credential"}
              </h2>
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                title="Schlie&szlig;en"
                className="rounded-md p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Username (SMTP Login)
                </label>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="user@example.com"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Password {editId && "(leave empty to keep current)"}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    placeholder={editId ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : "Enter password"}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Display Name
                </label>
                <input
                  value={form.display_name}
                  onChange={(e) =>
                    setForm({ ...form, display_name: e.target.value })
                  }
                  placeholder="Max Mustermann"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">
                  Allowed sender addresses (comma-separated, empty = all)
                </label>
                <input
                  value={form.allowed_from}
                  onChange={(e) =>
                    setForm({ ...form, allowed_from: e.target.value })
                  }
                  placeholder="user@example.com, info@example.com"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">
                    Max. Mails/Hour
                  </label>
                  <input
                    type="number"
                    value={form.max_messages_per_hour}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        max_messages_per_hour: parseInt(e.target.value) || 100,
                      })
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) =>
                        setForm({ ...form, is_active: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
                    />
                    Aktiv
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.username}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editId ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
