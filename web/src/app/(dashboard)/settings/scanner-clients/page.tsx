"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Server,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  Terminal,
  Shield,
} from "lucide-react";

interface ScannerClient {
  id: string;
  name: string;
  client_ip: string | null;
  pubkey: string;
  keypair_id: string;
  is_active: boolean;
  description: string | null;
  created_at: string;
}

interface CreateResult {
  pubkey: string;
  proxy_host: string;
  client_config: string;
  setup_instructions: string;
}

export default function ScannerClientsPage() {
  const [clients, setClients] = useState<ScannerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [name, setName] = useState("");
  const [clientIp, setClientIp] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scanner-clients");
      if (res.ok) setClients(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/scanner-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, client_ip: clientIp || null, description: description || null }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreateResult(data);
        await fetchClients();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/scanner-clients/${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    await fetchClients();
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Scanner Clients</h1>
            <p className="text-sm text-slate-400">
              Mail servers using SpamProxy as their remote scan engine
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateResult(null); setName(""); setClientIp(""); setDescription(""); }}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Client
        </button>
      </div>

      {/* How it works */}
      <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-300">
        <strong>How it works:</strong> Scanner clients run their own Postfix + rspamd proxy,
        but instead of scanning locally, they forward scan requests to this SpamProxy instance.
        This avoids double scanning and centralizes spam rules, Bayes training, and blocklists.
        Communication is encrypted using rspamd keypairs.
      </div>

      {/* Architecture diagram */}
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <pre className="text-xs text-slate-400 font-mono leading-relaxed">
{`Client Server                          SpamProxy Server
┌─────────────────────┐               ┌─────────────────────┐
│ Postfix (Port 25)   │               │ rspamd Normal Worker│
│   ↓                 │               │   (Port 11333)      │
│ rspamd proxy        │──encrypted──→ │   Scans mail        │
│   (Port 11332)      │    (curve25519)│   Returns score     │
│   ↓                 │               └─────────────────────┘
│ Postfix delivers    │
│   locally           │
└─────────────────────┘`}
        </pre>
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-6">
          {!createResult ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Add Scanner Client</h2>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Client Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. mail2.example.com"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Client IP (optional, for firewall)</label>
                <input value={clientIp} onChange={(e) => setClientIp(e.target.value)} placeholder="e.g. 1.2.3.4"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Description (optional)</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Secondary mail server"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={creating || !name}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                  Generate Keypair & Create
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-400">
                <Check className="h-5 w-5" />
                <h2 className="text-lg font-semibold">Client created: {name}</h2>
              </div>

              {/* Client Config */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-cyan-400" />
                    Client Config (worker-proxy.inc)
                  </h3>
                  <button onClick={() => copyText(createResult.client_config, "config")}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
                    {copied === "config" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <pre className="rounded-lg bg-slate-950 border border-slate-700 p-4 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
                  {createResult.client_config}
                </pre>
              </div>

              {/* Setup Instructions */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-2">Setup Instructions</h3>
                <div className="rounded-lg bg-slate-950 border border-slate-700 p-4 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
                  {createResult.setup_instructions}
                </div>
              </div>

              {/* Firewall hint */}
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                <strong>Important:</strong> Open port 11333 on the SpamProxy server for the client IP:
                <code className="block mt-1 font-mono text-yellow-300">
                  ./scripts/deploy.sh federation-add {clientIp || "<CLIENT-IP>"} &quot;{name}&quot;
                </code>
              </div>

              <button onClick={() => { setShowCreate(false); setCreateResult(null); }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* Client List */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /></div>
      ) : clients.length === 0 && !showCreate ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
          <Server className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">No Scanner Clients</h3>
          <p className="mt-2 text-sm text-slate-400">Add a client to use SpamProxy as a centralized scan engine.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((client) => (
            <div key={client.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-cyan-400" />
                    <h3 className="text-white font-semibold">{client.name}</h3>
                    {client.client_ip && (
                      <span className="font-mono text-xs text-slate-400">{client.client_ip}</span>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      client.is_active
                        ? "border-green-500/30 bg-green-500/10 text-green-400"
                        : "border-slate-600 bg-slate-700/50 text-slate-400"
                    }`}>
                      {client.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {client.description && <p className="mt-1 text-xs text-slate-500">{client.description}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-500">Public Key:</span>
                    <code className="font-mono text-xs text-slate-400">{client.pubkey.slice(0, 20)}...</code>
                    <button onClick={() => copyText(client.pubkey, `pub-${client.id}`)}
                      className="text-slate-500 hover:text-white transition-colors">
                      {copied === `pub-${client.id}` ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {deleteConfirm === client.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-400 mr-1">Delete?</span>
                      <button onClick={() => handleDelete(client.id)}
                        className="rounded p-1.5 text-red-400 hover:bg-red-500/20 transition-colors">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteConfirm(null)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-800 transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirm(client.id)}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
