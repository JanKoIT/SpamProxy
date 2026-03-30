"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  Globe,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";

interface DkimKey {
  id: string;
  domain: string;
  selector: string;
  key_bits: number;
  is_active: boolean;
  dns_record: string;
  created_at: string;
}

interface GenerateResult {
  id: string;
  domain: string;
  selector: string;
  key_bits: number;
  dns_record: string;
}

export default function DkimPage() {
  const [keys, setKeys] = useState<DkimKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<GenerateResult | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [formDomain, setFormDomain] = useState("");
  const [formSelector, setFormSelector] = useState("spamproxy");
  const [formKeySize, setFormKeySize] = useState(2048);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dkim");
      if (!res.ok) throw new Error("Fehler beim Laden der DKIM-Keys");
      const data: DkimKey[] = await res.json();
      setKeys(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  function openGenerateDialog() {
    setFormDomain("");
    setFormSelector("spamproxy");
    setFormKeySize(2048);
    setGeneratedResult(null);
    setShowDialog(true);
    setError(null);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/dkim/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: formDomain,
          selector: formSelector,
          key_bits: formKeySize,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Fehler beim Generieren des DKIM-Keys");
      }
      const data: GenerateResult = await res.json();
      setGeneratedResult(data);
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/dkim/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim Loeschen des DKIM-Keys");
      setDeleteConfirm(null);
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    }
  }

  async function handleToggle(id: string) {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/dkim/${id}`, { method: "PUT" });
      if (!res.ok) throw new Error("Fehler beim Umschalten des DKIM-Keys");
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setTogglingId(null);
    }
  }

  function copyToClipboard(text: string, fieldId: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Key className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">DKIM Keys</h1>
            <p className="text-sm text-slate-400">
              DKIM-Signierung fuer ausgehende E-Mails verwalten
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openGenerateDialog}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Key generieren
        </button>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
        <Info className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-300">
          <p className="font-medium">DNS-Konfiguration erforderlich</p>
          <p className="mt-1 text-blue-300/80">
            Nach dem Generieren eines DKIM-Keys muss der angezeigte DNS-TXT-Record beim
            Domain-Provider eingetragen werden, damit DKIM-Signierung funktioniert.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* DKIM Keys Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="px-4 py-3 font-medium w-8"></th>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Selector</th>
              <th className="px-4 py-3 font-medium">Key Bits</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Erstellt</th>
              <th className="px-4 py-3 font-medium text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  Noch keine DKIM-Keys konfiguriert. Klicken Sie auf &quot;Key generieren&quot;.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <>
                <tr
                  key={k.id}
                  className="hover:bg-slate-800/60 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpandedRow(expandedRow === k.id ? null : k.id)}
                      className="text-slate-400 hover:text-white transition-colors"
                      title="DNS-Record anzeigen"
                    >
                      {expandedRow === k.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-blue-400" />
                      <span className="font-medium text-white">{k.domain}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300">{k.selector}</td>
                  <td className="px-4 py-3 text-slate-300">{k.key_bits}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleToggle(k.id)}
                      disabled={togglingId === k.id}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        k.is_active ? "bg-blue-600" : "bg-slate-700"
                      } ${togglingId === k.id ? "opacity-50" : ""}`}
                      title={k.is_active ? "Deaktivieren" : "Aktivieren"}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                          k.is_active ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(k.created_at).toLocaleDateString("de-DE")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {deleteConfirm === k.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(k.id)}
                          className="rounded-md p-1.5 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Loeschen bestaetigen"
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
                        onClick={() => setDeleteConfirm(k.id)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        title="Loeschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
                {expandedRow === k.id && (
                  <tr key={`${k.id}-dns`} className="bg-slate-800/40">
                    <td colSpan={7} className="px-6 py-4">
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-slate-300">DNS-Record</p>
                        <div className="grid gap-2">
                          <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
                            <div>
                              <span className="text-xs text-slate-500">DNS Name</span>
                              <p className="font-mono text-sm text-white">
                                {k.selector}._domainkey.{k.domain}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                copyToClipboard(
                                  `${k.selector}._domainkey.${k.domain}`,
                                  `name-${k.id}`
                                )
                              }
                              className="rounded-md p-1.5 text-slate-400 hover:text-white transition-colors"
                              title="Kopieren"
                            >
                              {copiedField === `name-${k.id}` ? (
                                <Check className="h-4 w-4 text-green-400" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                          <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
                            <div>
                              <span className="text-xs text-slate-500">DNS Typ</span>
                              <p className="font-mono text-sm text-white">TXT</p>
                            </div>
                          </div>
                          <div className="flex items-start justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
                            <div className="min-w-0 flex-1 mr-2">
                              <span className="text-xs text-slate-500">DNS Wert</span>
                              <p className="font-mono text-xs text-white break-all">
                                {k.dns_record}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                copyToClipboard(k.dns_record, `value-${k.id}`)
                              }
                              className="rounded-md p-1.5 text-slate-400 hover:text-white transition-colors shrink-0 mt-2"
                              title="Kopieren"
                            >
                              {copiedField === `value-${k.id}` ? (
                                <Check className="h-4 w-4 text-green-400" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {generatedResult ? "DKIM-Key generiert" : "DKIM-Key generieren"}
              </h2>
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                title="Schliessen"
                className="rounded-md p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!generatedResult ? (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Domain *
                    </label>
                    <input
                      value={formDomain}
                      onChange={(e) => setFormDomain(e.target.value)}
                      placeholder="example.com"
                      className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Selector
                    </label>
                    <input
                      value={formSelector}
                      onChange={(e) => setFormSelector(e.target.value)}
                      placeholder="spamproxy"
                      className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-300">
                      Key-Groesse
                    </label>
                    <select
                      value={formKeySize}
                      onChange={(e) => setFormKeySize(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value={2048}>2048 Bit</option>
                      <option value={4096}>4096 Bit</option>
                    </select>
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
                    onClick={handleGenerate}
                    disabled={generating || !formDomain}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {generating && <Loader2 className="h-4 w-4 animate-spin" />}
                    Generieren
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                    DKIM-Key erfolgreich generiert. Bitte den folgenden DNS-Record eintragen:
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
                      <div>
                        <span className="text-xs text-slate-500">DNS Name</span>
                        <p className="font-mono text-sm text-white">
                          {generatedResult.selector}._domainkey.{generatedResult.domain}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            `${generatedResult.selector}._domainkey.${generatedResult.domain}`,
                            "gen-name"
                          )
                        }
                        className="rounded-md p-1.5 text-slate-400 hover:text-white transition-colors"
                        title="Kopieren"
                      >
                        {copiedField === "gen-name" ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
                      <div>
                        <span className="text-xs text-slate-500">DNS Typ</span>
                        <p className="font-mono text-sm text-white">TXT</p>
                      </div>
                    </div>

                    <div className="flex items-start justify-between rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="text-xs text-slate-500">DNS Wert</span>
                        <p className="font-mono text-xs text-white break-all">
                          {generatedResult.dns_record}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(generatedResult.dns_record, "gen-value")
                        }
                        className="rounded-md p-1.5 text-slate-400 hover:text-white transition-colors shrink-0 mt-2"
                        title="Kopieren"
                      >
                        {copiedField === "gen-value" ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowDialog(false)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    Schliessen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
