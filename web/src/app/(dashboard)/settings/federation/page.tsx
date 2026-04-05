"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Network,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Loader2,
  Brain,
  Fingerprint,
  ArrowLeftRight,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
} from "lucide-react";

interface Peer {
  id: string;
  name: string;
  url: string;
  password?: string;
  active: boolean;
  direction: "push" | "pull" | "both";
  sync_bayes: boolean;
  sync_fuzzy: boolean;
  total_synced: number;
  last_sync: string | null;
  last_error: string | null;
}

interface TestResult {
  rspamd_version: string;
  scanned: number;
  learned: number;
  response_time: string;
}

interface PeerForm {
  name: string;
  url: string;
  password: string;
  direction: "push" | "pull" | "both";
  sync_bayes: boolean;
  sync_fuzzy: boolean;
}

const emptyForm: PeerForm = {
  name: "",
  url: "",
  password: "",
  direction: "both",
  sync_bayes: true,
  sync_fuzzy: true,
};

export default function FederationPage() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PeerForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({});
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [showPassword, setShowPassword] = useState(false);

  const fetchPeers = useCallback(async () => {
    try {
      const res = await fetch("/api/federation/peers");
      if (res.ok) {
        const data = await res.json();
        setPeers(Array.isArray(data) ? data : data.peers ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPeers();
  }, [fetchPeers]);

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowPassword(false);
    setDialogOpen(true);
  };

  const openEdit = (peer: Peer) => {
    setForm({
      name: peer.name,
      url: peer.url,
      password: peer.password ?? "",
      direction: peer.direction,
      sync_bayes: peer.sync_bayes,
      sync_fuzzy: peer.sync_fuzzy,
    });
    setEditingId(peer.id);
    setShowPassword(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/federation/peers/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      } else {
        await fetch("/api/federation/peers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      setDialogOpen(false);
      await fetchPeers();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    await fetch(`/api/federation/peers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggle: true }),
    });
    await fetchPeers();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/federation/peers/${id}`, { method: "DELETE" });
    await fetchPeers();
  };

  const handleTest = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    setTestResults((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await fetch(`/api/federation/peers/${id}/test`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTestResults((prev) => ({ ...prev, [id]: data }));
      }
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const directionLabel = (d: string) =>
    d === "push" ? "Push" : d === "pull" ? "Pull" : "Both";
  const directionColor = (d: string) =>
    d === "push"
      ? "bg-blue-500/20 text-blue-400"
      : d === "pull"
        ? "bg-green-500/20 text-green-400"
        : "bg-purple-500/20 text-purple-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Network className="h-7 w-7 text-blue-500" />
            <h1 className="text-2xl font-bold text-white">Federation</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Connect rspamd servers and share knowledge
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Peer
        </button>
      </div>

      {/* Info Banner */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-slate-300">
        Federation allows sharing spam/ham knowledge between multiple SpamProxy
        or rspamd instances. When an email is learned as spam or ham,
        this knowledge is automatically propagated to all active peers.
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-700/50 bg-slate-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Brain className="h-5 w-5 text-purple-400" />
            </div>
            <h3 className="font-semibold text-white">Bayes Learning</h3>
          </div>
          <p className="text-sm text-slate-400">
            Spam/ham decisions are forwarded to peers so that all
            servers benefit from the same training
          </p>
        </div>

        <div className="rounded-lg border border-slate-700/50 bg-slate-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Fingerprint className="h-5 w-5 text-blue-400" />
            </div>
            <h3 className="font-semibold text-white">Fuzzy Hashes</h3>
          </div>
          <p className="text-sm text-slate-400">
            Spam fingerprints are shared so that known spam patterns
            are immediately recognized on all servers
          </p>
        </div>

        <div className="rounded-lg border border-slate-700/50 bg-slate-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-green-500/20 p-2">
              <ArrowLeftRight className="h-5 w-5 text-green-400" />
            </div>
            <h3 className="font-semibold text-white">Direction</h3>
          </div>
          <p className="text-sm text-slate-400">
            Push: Send own knowledge. Pull: Learn from peers. Both:
            Bidirectional exchange
          </p>
        </div>
      </div>

      {/* Peers */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : peers.length === 0 ? (
        <div className="rounded-lg border border-slate-700/50 bg-slate-800 p-8 text-center">
          <Network className="mx-auto h-10 w-10 text-slate-600 mb-3" />
          <p className="text-slate-400">
            No peers configured. Click &quot;Add
            Peer&quot; to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {peers.map((peer) => (
            <div
              key={peer.id}
              className="rounded-lg border border-slate-700/50 bg-slate-800 p-5"
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-white truncate">
                    {peer.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-sm text-slate-400 truncate">
                    {peer.url}
                  </p>
                </div>
                <button
                  onClick={() => handleToggle(peer.id)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                    peer.active ? "bg-blue-600" : "bg-slate-600"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                      peer.active ? "translate-x-5 ml-0.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Badges */}
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${directionColor(peer.direction)}`}
                >
                  {directionLabel(peer.direction)}
                </span>
                {peer.sync_bayes && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-medium text-purple-400">
                    <Brain className="h-3 w-3" /> Bayes
                  </span>
                )}
                {peer.sync_fuzzy && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                    <Fingerprint className="h-3 w-3" /> Fuzzy
                  </span>
                )}
              </div>

              {/* Stats */}
              <div className="mt-3 flex items-center gap-6 text-sm text-slate-400">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Syncs: {peer.total_synced}
                </span>
                <span>
                  Last Sync: {peer.last_sync ?? "never"}
                </span>
              </div>

              {/* Error */}
              {peer.last_error && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  {peer.last_error}
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => handleTest(peer.id)}
                  disabled={testingIds.has(peer.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  {testingIds.has(peer.id) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Test Connection
                </button>
                <button
                  onClick={() => openEdit(peer)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(peer.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* Test Result */}
              {testResults[peer.id] && (
                <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <span className="text-sm font-medium text-green-400">
                      Connection successful
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-slate-300 md:grid-cols-4">
                    <div>
                      <span className="text-slate-500">rspamd:</span>{" "}
                      {testResults[peer.id]!.rspamd_version}
                    </div>
                    <div>
                      <span className="text-slate-500">Scanned:</span>{" "}
                      {testResults[peer.id]!.scanned}
                    </div>
                    <div>
                      <span className="text-slate-500">Learned:</span>{" "}
                      {testResults[peer.id]!.learned}
                    </div>
                    <div>
                      <span className="text-slate-500">Response time:</span>{" "}
                      {testResults[peer.id]!.response_time}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-lg border border-slate-700/50 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? "Edit Peer" : "Add Peer"}
              </h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* URL */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  URL
                </label>
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="http://remote-rspamd:11333"
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Password{" "}
                  <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 pr-10 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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

              {/* Sync Options */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Sync Options
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sync_bayes}
                      onChange={(e) =>
                        setForm({ ...form, sync_bayes: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    Bayes Learning
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sync_fuzzy}
                      onChange={(e) =>
                        setForm({ ...form, sync_fuzzy: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    Fuzzy Hashes
                  </label>
                </div>
              </div>

              {/* Direction */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Direction
                </label>
                <div className="flex items-center gap-4">
                  {(["push", "pull", "both"] as const).map((d) => (
                    <label
                      key={d}
                      className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="direction"
                        value={d}
                        checked={form.direction === d}
                        onChange={() => setForm({ ...form, direction: d })}
                        className="h-4 w-4 border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                      />
                      {d === "push" ? "Push" : d === "pull" ? "Pull" : "Both"}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Dialog Actions */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setDialogOpen(false)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.url}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {editingId ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
