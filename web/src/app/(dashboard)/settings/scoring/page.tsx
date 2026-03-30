"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Info,
  X,
} from "lucide-react";

interface ScoringRule {
  id: number;
  rule_type: string;
  pattern: string;
  score_adjustment: number;
  description: string;
  is_active: boolean;
  created_at: string;
}

const ruleTypeOptions = [
  { value: "tld", label: "TLD-Endung" },
  { value: "domain", label: "Domain" },
  { value: "sender_domain", label: "Absender-Domain" },
];

const ruleTypePlaceholders: Record<string, string> = {
  tld: ".ru",
  domain: "example.com",
  sender_domain: "spam.example.com",
};

const ruleTypeBadgeColors: Record<string, string> = {
  tld: "bg-blue-500/20 text-blue-400",
  domain: "bg-purple-500/20 text-purple-400",
  sender_domain: "bg-orange-500/20 text-orange-400",
};

export default function ScoringPage() {
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<ScoringRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formRuleType, setFormRuleType] = useState("tld");
  const [formPattern, setFormPattern] = useState("");
  const [formScore, setFormScore] = useState<number>(0);
  const [formDescription, setFormDescription] = useState("");

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scoring-rules");
      if (!res.ok) throw new Error("Fehler beim Laden der Regeln");
      const data = await res.json();
      const arr: ScoringRule[] = Array.isArray(data) ? data : [];
      // Sort by rule_type then score_adjustment desc
      arr.sort((a, b) => {
        if (a.rule_type !== b.rule_type) return a.rule_type.localeCompare(b.rule_type);
        return b.score_adjustment - a.score_adjustment;
      });
      setRules(arr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  function openAddDialog() {
    setEditingRule(null);
    setFormRuleType("tld");
    setFormPattern("");
    setFormScore(0);
    setFormDescription("");
    setShowDialog(true);
  }

  function openEditDialog(rule: ScoringRule) {
    setEditingRule(rule);
    setFormRuleType(rule.rule_type);
    setFormPattern(rule.pattern);
    setFormScore(rule.score_adjustment);
    setFormDescription(rule.description);
    setShowDialog(true);
  }

  async function handleSave() {
    if (!formPattern.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingRule) {
        // Update
        const res = await fetch(`/api/scoring-rules/${editingRule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rule_type: formRuleType,
            pattern: formPattern.trim(),
            score_adjustment: formScore,
            description: formDescription.trim(),
          }),
        });
        if (!res.ok) throw new Error("Fehler beim Speichern");
      } else {
        // Create
        const res = await fetch("/api/scoring-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rule_type: formRuleType,
            pattern: formPattern.trim(),
            score_adjustment: formScore,
            description: formDescription.trim(),
          }),
        });
        if (!res.ok) throw new Error("Fehler beim Hinzufuegen");
      }
      setShowDialog(false);
      setEditingRule(null);
      await loadRules();
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
      const res = await fetch(`/api/scoring-rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle: true }),
      });
      if (!res.ok) throw new Error("Fehler beim Umschalten");
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, is_active: !r.is_active } : r))
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
      const res = await fetch(`/api/scoring-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim Loeschen");
      setRules((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setDeletingId(null);
    }
  }

  function formatScore(score: number): { text: string; className: string } {
    if (score > 0) return { text: `+${score}`, className: "text-red-400" };
    if (score < 0) return { text: `${score}`, className: "text-green-400" };
    return { text: "0", className: "text-slate-500" };
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <TrendingUp className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Score-Anpassungen</h1>
          <p className="text-sm text-slate-400">
            TLD- und Domain-basierte Score-Anpassungen fuer Spam-Erkennung
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Info box */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-400">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        Positive Werte erhoehen den Spam-Score (mehr Spam-Verdacht), negative Werte verringern ihn
        (vertrauenswuerdiger). Basis-Score wird von rspamd berechnet.
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={openAddDialog}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Regel hinzufuegen
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center text-sm text-slate-500">
          Keine Regeln vorhanden
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50">
                <th className="px-4 py-3 text-left font-medium text-slate-400">Aktiv</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Typ</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Pattern</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Score</th>
                <th className="px-4 py-3 text-left font-medium text-slate-400">Beschreibung</th>
                <th className="px-4 py-3 text-right font-medium text-slate-400">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const score = formatScore(rule.score_adjustment);
                return (
                  <tr
                    key={rule.id}
                    className="border-b border-slate-800/50 bg-slate-900 hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(rule.id)}
                        disabled={togglingId === rule.id}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          rule.is_active ? "bg-blue-600" : "bg-slate-700"
                        } ${togglingId === rule.id ? "opacity-50" : ""}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            rule.is_active ? "translate-x-4.5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          ruleTypeBadgeColors[rule.rule_type] ?? "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {ruleTypeOptions.find((o) => o.value === rule.rule_type)?.label ?? rule.rule_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-white">{rule.pattern}</td>
                    <td className={`px-4 py-3 font-mono font-semibold ${score.className}`}>
                      {score.text}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{rule.description || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {confirmDeleteId === rule.id ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-slate-400">Wirklich loeschen?</span>
                          <button
                            onClick={() => handleDelete(rule.id)}
                            disabled={deletingId === rule.id}
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {deletingId === rule.id ? (
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
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openEditDialog(rule)}
                            className="rounded p-1.5 text-slate-500 hover:bg-blue-500/10 hover:text-blue-400 transition-colors"
                            title="Bearbeiten"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(rule.id)}
                            className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                            title="Loeschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {editingRule ? "Regel bearbeiten" : "Regel hinzufuegen"}
              </h2>
              <button
                onClick={() => {
                  setShowDialog(false);
                  setEditingRule(null);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Rule Type */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Typ</label>
                <select
                  value={formRuleType}
                  onChange={(e) => setFormRuleType(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {ruleTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pattern */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Pattern</label>
                <input
                  type="text"
                  value={formPattern}
                  onChange={(e) => setFormPattern(e.target.value)}
                  placeholder={ruleTypePlaceholders[formRuleType] ?? ""}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-mono placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Score Adjustment */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Score-Anpassung
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={formScore}
                  onChange={(e) => setFormScore(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white font-mono placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Positiv = mehr Spam-Verdacht, Negativ = vertrauenswuerdiger
                </p>
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
                onClick={() => {
                  setShowDialog(false);
                  setEditingRule(null);
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formPattern.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingRule ? "Speichern" : "Hinzufuegen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
