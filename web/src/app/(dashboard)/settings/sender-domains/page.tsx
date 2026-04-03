"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Send,
  Plus,
  Globe,
  CheckCircle,
  XCircle,
  AlertTriangle,
  MinusCircle,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  X,
  Loader2,
  ExternalLink,
  Key,
  Shield,
} from "lucide-react";

/* ---------- Types ---------- */

interface DnsStatus {
  spf_status: string;
  spf_record?: string;
  spf_includes_proxy?: boolean;
  spf_hint?: string;
  dkim_status: string;
  dkim_record?: string;
  dkim_hint?: string;
  mx_status: string;
  mx_records?: string[];
  mx_hint?: string;
}

interface SenderDomain {
  id: string;
  domain: string;
  verified: boolean;
  active: boolean;
  verification_method: string;
  verification_token?: string;
  description?: string;
  dns_status?: DnsStatus;
  created_at?: string;
}

/* ---------- Helpers ---------- */

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "ok":
      return <CheckCircle className="h-5 w-5 text-green-400" />;
    case "missing":
      return <XCircle className="h-5 w-5 text-red-400" />;
    case "invalid":
      return <AlertTriangle className="h-5 w-5 text-yellow-400" />;
    default:
      return <MinusCircle className="h-5 w-5 text-slate-500" />;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "ok":
      return "OK";
    case "missing":
      return "Fehlt";
    case "invalid":
      return "Ungueltig";
    default:
      return "Nicht geprueft";
  }
}

/* ---------- Main Page ---------- */

export default function SenderDomainsPage() {
  const [domains, setDomains] = useState<SenderDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // add form
  const [newDomain, setNewDomain] = useState("");
  const [newMethod, setNewMethod] = useState<"dns" | "manual">("dns");
  const [newDescription, setNewDescription] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [createdDomain, setCreatedDomain] = useState<SenderDomain | null>(null);

  // per-domain loading states
  const [dnsLoading, setDnsLoading] = useState<Record<string, boolean>>({});
  const [verifyLoading, setVerifyLoading] = useState<Record<string, boolean>>(
    {}
  );
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // clipboard
  const [copied, setCopied] = useState<string | null>(null);

  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/sender-domains");
      if (res.ok) {
        const data = await res.json();
        setDomains(Array.isArray(data) ? data : data.domains ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  /* --- Actions --- */

  async function handleAdd() {
    if (!newDomain.trim()) return;
    setAddLoading(true);
    try {
      const res = await fetch("/api/sender-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: newDomain.trim(),
          verification_method: newMethod,
          description: newDescription.trim() || undefined,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setCreatedDomain(created);
        setNewDomain("");
        setNewDescription("");
        fetchDomains();
      }
    } finally {
      setAddLoading(false);
    }
  }

  async function handleCheckDns(id: string) {
    setDnsLoading((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/sender-domains/${id}/check-dns`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchDomains();
      }
    } finally {
      setDnsLoading((p) => ({ ...p, [id]: false }));
    }
  }

  async function handleVerify(id: string, method: string = "") {
    setVerifyLoading((p) => ({ ...p, [id]: true }));
    try {
      const res = await fetch(`/api/sender-domains/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.detail || "Verifizierung fehlgeschlagen");
      }
      await fetchDomains();
    } finally {
      setVerifyLoading((p) => ({ ...p, [id]: false }));
    }
  }

  async function handleToggle(id: string) {
    await fetch(`/api/sender-domains/${id}`, { method: "PUT" });
    fetchDomains();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/sender-domains/${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    fetchDomains();
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  /* ---------- Render ---------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white">
            <Send className="h-7 w-7 text-blue-400" />
            Absenderdomains
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Verifizierte Domains fuer ausgehenden E-Mail-Versand
          </p>
        </div>
        <button
          onClick={() => {
            setShowAdd(true);
            setCreatedDomain(null);
          }}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Domain hinzufuegen
        </button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-200">
        <div className="flex gap-3">
          <Shield className="h-5 w-5 shrink-0 text-blue-400 mt-0.5" />
          <p>
            Nur verifizierte und aktive Domains koennen fuer ausgehende E-Mails
            verwendet werden. Jede Domain muss per DNS-Eintrag oder manuell
            verifiziert werden. SPF und DKIM muessen korrekt konfiguriert sein.
          </p>
        </div>
      </div>

      {/* Add Dialog */}
      {showAdd && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Neue Domain hinzufuegen
            </h2>
            <button
              onClick={() => {
                setShowAdd(false);
                setCreatedDomain(null);
              }}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {!createdDomain ? (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Domain
                </label>
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Verifizierungsmethode
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="method"
                      checked={newMethod === "dns"}
                      onChange={() => setNewMethod("dns")}
                      className="accent-blue-500"
                    />
                    DNS-Verifizierung
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="method"
                      checked={newMethod === "manual"}
                      onChange={() => setNewMethod("manual")}
                      className="accent-blue-500"
                    />
                    Manuelle Verifizierung
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Beschreibung (optional)
                </label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="z.B. Hauptdomain fuer Newsletter"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleAdd}
                  disabled={addLoading || !newDomain.trim()}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addLoading && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Domain hinzufuegen
                </button>
              </div>
            </>
          ) : (
            /* Post-creation: show token */
            <div className="space-y-4">
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                <div className="flex items-center gap-2 text-green-300 font-medium mb-2">
                  <CheckCircle className="h-5 w-5" />
                  Domain &quot;{createdDomain.domain}&quot; wurde erstellt
                </div>
              </div>

              {createdDomain.verification_token && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-300">
                    <Key className="inline h-4 w-4 mr-1 text-yellow-400" />
                    Verifizierungstoken:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-4 py-3 text-sm text-green-300 font-mono break-all">
                      {createdDomain.verification_token}
                    </code>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          createdDomain.verification_token!,
                          "created-token"
                        )
                      }
                      className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
                    >
                      {copied === "created-token" ? (
                        <Check className="h-4 w-4 text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                    Erstelle einen TXT-Record fuer{" "}
                    <code className="font-mono text-yellow-300">
                      {createdDomain.domain}
                    </code>{" "}
                    oder{" "}
                    <code className="font-mono text-yellow-300">
                      _spamproxy.{createdDomain.domain}
                    </code>{" "}
                    mit dem obigen Token als Wert.
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setShowAdd(false);
                    setCreatedDomain(null);
                  }}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Schliessen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && domains.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
          <Globe className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-white">
            Keine Absenderdomains
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Fuege eine Domain hinzu, um ausgehende E-Mails zu versenden.
          </p>
        </div>
      )}

      {/* Domain Cards */}
      <div className="space-y-4">
        {domains.map((domain) => (
          <DomainCard
            key={domain.id}
            domain={domain}
            dnsLoading={!!dnsLoading[domain.id]}
            verifyLoading={!!verifyLoading[domain.id]}
            deleteConfirm={deleteConfirm === domain.id}
            copied={copied}
            onCheckDns={() => handleCheckDns(domain.id)}
            onVerify={() => handleVerify(domain.id, "dns")}
            onManualVerify={() => handleVerify(domain.id, "manual")}
            onToggle={() => handleToggle(domain.id)}
            onDelete={() => handleDelete(domain.id)}
            onDeleteConfirm={() => setDeleteConfirm(domain.id)}
            onDeleteCancel={() => setDeleteConfirm(null)}
            onCopy={copyToClipboard}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Domain Card ---------- */

interface DomainCardProps {
  domain: SenderDomain;
  dnsLoading: boolean;
  verifyLoading: boolean;
  deleteConfirm: boolean;
  copied: string | null;
  onCheckDns: () => void;
  onVerify: () => void;
  onManualVerify: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onCopy: (text: string, key: string) => void;
}

function DomainCard({
  domain,
  dnsLoading,
  verifyLoading,
  deleteConfirm,
  copied,
  onCheckDns,
  onVerify,
  onManualVerify,
  onToggle,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
  onCopy,
}: DomainCardProps) {
  const dns = domain.dns_status;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-4">
      {/* Top row: domain + badges */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">{domain.domain}</h3>
          {domain.description && (
            <span className="text-sm text-slate-500">
              — {domain.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {domain.verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/30 px-2.5 py-0.5 text-xs font-medium text-green-400">
              <CheckCircle className="h-3 w-3" />
              Verifiziert
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-2.5 py-0.5 text-xs font-medium text-yellow-400">
              <AlertTriangle className="h-3 w-3" />
              Nicht verifiziert
            </span>
          )}
          {domain.active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/30 px-2.5 py-0.5 text-xs font-medium text-green-400">
              Aktiv
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 border border-slate-500/30 px-2.5 py-0.5 text-xs font-medium text-slate-400">
              Inaktiv
            </span>
          )}
        </div>
      </div>

      {/* DNS Status */}
      {dns && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* SPF */}
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <StatusIcon status={dns.spf_status} />
              <span className="text-sm font-medium text-white">SPF</span>
              <span className="text-xs text-slate-500">
                {statusLabel(dns.spf_status)}
              </span>
            </div>
            {dns.spf_record && (
              <code className="block text-xs text-slate-400 font-mono break-all bg-slate-900 rounded px-2 py-1">
                {dns.spf_record}
              </code>
            )}
            {dns.spf_status === "ok" &&
              dns.spf_includes_proxy === false && (
                <p className="text-xs text-yellow-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  SPF-Record enthaelt nicht den Proxy-Server
                </p>
              )}
            {dns.spf_hint && (
              <div className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-200">
                {dns.spf_hint}
              </div>
            )}
          </div>

          {/* DKIM */}
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <StatusIcon status={dns.dkim_status} />
              <span className="text-sm font-medium text-white">DKIM</span>
              <span className="text-xs text-slate-500">
                {statusLabel(dns.dkim_status)}
              </span>
            </div>
            {dns.dkim_record && (
              <code className="block text-xs text-slate-400 font-mono break-all bg-slate-900 rounded px-2 py-1">
                {dns.dkim_record}
              </code>
            )}
            {dns.dkim_status === "missing" && (
              <a
                href="/settings/dkim"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <ExternalLink className="h-3 w-3" />
                DKIM konfigurieren
              </a>
            )}
            {dns.dkim_hint && (
              <div className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-200">
                {dns.dkim_hint}
              </div>
            )}
          </div>

          {/* MX */}
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <StatusIcon status={dns.mx_status} />
              <span className="text-sm font-medium text-white">MX</span>
              <span className="text-xs text-slate-500">
                {statusLabel(dns.mx_status)}
              </span>
            </div>
            {dns.mx_records && dns.mx_records.length > 0 && (
              <ul className="space-y-1">
                {dns.mx_records.map((rec, i) => (
                  <li
                    key={i}
                    className="text-xs text-slate-400 font-mono break-all bg-slate-900 rounded px-2 py-1"
                  >
                    {rec}
                  </li>
                ))}
              </ul>
            )}
            {dns.mx_hint && (
              <div className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-200">
                {dns.mx_hint}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verification Token (only if not verified) */}
      {!domain.verified && domain.verification_token && (
        <div className="rounded-lg border border-slate-700 bg-slate-950 p-4 space-y-3">
          <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <Key className="h-4 w-4 text-yellow-400" />
            Verifizierungstoken
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-4 py-2.5 text-sm text-green-300 font-mono break-all">
              {domain.verification_token}
            </code>
            <button
              onClick={() =>
                onCopy(domain.verification_token!, `token-${domain.id}`)
              }
              className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
            >
              {copied === `token-${domain.id}` ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Erstelle einen TXT-Record fuer{" "}
            <code className="font-mono text-slate-300">{domain.domain}</code>{" "}
            oder{" "}
            <code className="font-mono text-slate-300">
              _spamproxy.{domain.domain}
            </code>{" "}
            mit dem obigen Token als Wert.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onVerify}
              disabled={verifyLoading}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 transition-colors disabled:opacity-50"
            >
              {verifyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              DNS verifizieren
            </button>
            <button
              onClick={onManualVerify}
              disabled={verifyLoading}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              {verifyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Manuell freischalten
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
        <button
          onClick={onCheckDns}
          disabled={dnsLoading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
        >
          {dnsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          DNS pruefen
        </button>

        {domain.verified && (
          <button
            onClick={onToggle}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              domain.active
                ? "border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                : "border-green-500/30 text-green-400 hover:bg-green-500/10"
            }`}
          >
            {domain.active ? "Deaktivieren" : "Aktivieren"}
          </button>
        )}

        {!deleteConfirm ? (
          <button
            onClick={onDeleteConfirm}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
          >
            <Trash2 className="h-4 w-4" />
            Loeschen
          </button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-red-400">Wirklich loeschen?</span>
            <button
              onClick={onDelete}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 transition-colors"
            >
              Ja, loeschen
            </button>
            <button
              onClick={onDeleteCancel}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
