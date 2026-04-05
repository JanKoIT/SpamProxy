"use client";

import { useEffect, useState } from "react";
import { useRef } from "react";
import { Type, Plus, Pencil, Trash2, X, Info, Loader2, Download, Upload } from "lucide-react";

interface KeywordRule {
  id: string;
  keyword: string;
  match_type: "contains" | "exact" | "regex";
  match_field: "subject" | "body" | "from" | "any";
  score_adjustment: number;
  description?: string;
  is_active: boolean;
}

const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: "Contains",
  exact: "Exact",
  regex: "Regex",
};

const MATCH_FIELD_LABELS: Record<string, string> = {
  subject: "Subject",
  body: "Body",
  from: "Sender",
  any: "Any",
};

const MATCH_TYPE_COLORS: Record<string, string> = {
  contains: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  exact: "bg-green-500/20 text-green-400 border-green-500/30",
  regex: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

const MATCH_FIELD_COLORS: Record<string, string> = {
  subject: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  body: "bg-green-500/20 text-green-400 border-green-500/30",
  from: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  any: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export default function KeywordsPage() {
  const [rules, setRules] = useState<KeywordRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<KeywordRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [keyword, setKeyword] = useState("");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [matchField, setMatchField] = useState<"subject" | "body" | "from" | "any">("any");
  const [scoreAdjustment, setScoreAdjustment] = useState(1);
  const [description, setDescription] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importLoading, setImportLoading] = useState(false);

  async function handleExport() {
    const res = await fetch("/api/keyword-rules/export");
    const data = await res.json();
    data.count = data.rules?.length ?? 0;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spamproxy-keywords-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File, mode: string) {
    setImportLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/keyword-rules/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: data.rules, mode }),
      });
      const result = await res.json();
      alert(`Import: ${result.imported} imported, ${result.skipped} skipped`);
      fetchRules();
    } catch (e) {
      alert("Import failed: " + (e instanceof Error ? e.message : "Unknown error"));
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function fetchRules() {
    try {
      const res = await fetch("/api/keyword-rules");
      const data = await res.json();
      setRules(Array.isArray(data) ? data : data.rules ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRules();
  }, []);

  function openCreate() {
    setEditingRule(null);
    setKeyword("");
    setMatchType("contains");
    setMatchField("any");
    setScoreAdjustment(1);
    setDescription("");
    setDialogOpen(true);
  }

  function openEdit(rule: KeywordRule) {
    setEditingRule(rule);
    setKeyword(rule.keyword);
    setMatchType(rule.match_type);
    setMatchField(rule.match_field);
    setScoreAdjustment(rule.score_adjustment);
    setDescription(rule.description ?? "");
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      keyword,
      match_type: matchType,
      match_field: matchField,
      score_adjustment: scoreAdjustment,
      description: description || undefined,
    };

    if (editingRule) {
      await fetch(`/api/keyword-rules/${editingRule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch("/api/keyword-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    setDialogOpen(false);
    fetchRules();
  }

  async function handleToggle(rule: KeywordRule) {
    await fetch(`/api/keyword-rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggle: true }),
    });
    fetchRules();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/keyword-rules/${id}`, { method: "DELETE" });
    setDeleteConfirm(null);
    fetchRules();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Type className="h-7 w-7 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-white">Keyword Rules</h1>
            <p className="text-sm text-slate-400">
              Keywords with score adjustments for spam detection
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const mode = confirm("Keep existing rules and add new ones?\n\nOK = Merge\nCancel = Replace all") ? "merge" : "replace";
                handleImport(file, mode);
              }
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Keyword
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-300">
          Keywords are searched in subject, body or sender. Positive scores increase
          spam suspicion, negative scores decrease it.
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-400">
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium">Keyword</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium text-right">Score</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rules.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    No keyword rules configured.
                  </td>
                </tr>
              )}
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-800/60 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(rule)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        rule.is_active ? "bg-blue-600" : "bg-slate-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          rule.is_active ? "translate-x-4.5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-white">{rule.keyword}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                        MATCH_TYPE_COLORS[rule.match_type] ?? ""
                      }`}
                    >
                      {MATCH_TYPE_LABELS[rule.match_type] ?? rule.match_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                        MATCH_FIELD_COLORS[rule.match_field] ?? ""
                      }`}
                    >
                      {MATCH_FIELD_LABELS[rule.match_field] ?? rule.match_field}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span
                      className={
                        rule.score_adjustment > 0
                          ? "text-red-400"
                          : rule.score_adjustment < 0
                            ? "text-green-400"
                            : "text-slate-400"
                      }
                    >
                      {rule.score_adjustment > 0 ? "+" : ""}
                      {rule.score_adjustment}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[200px] truncate">
                    {rule.description ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(rule)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(rule.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-900/30 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {editingRule ? "Edit Keyword" : "Add Keyword"}
              </h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Keyword</label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  required
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. viagra, lottery, ..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value as typeof matchType)}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="contains">Contains</option>
                    <option value="exact">Exact</option>
                    <option value="regex">Regex</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Field</label>
                  <select
                    value={matchField}
                    onChange={(e) => setMatchField(e.target.value as typeof matchField)}
                    className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="subject">Subject</option>
                    <option value="body">Body</option>
                    <option value="from">Sender</option>
                    <option value="any">Any</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Score Adjustment
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={scoreAdjustment}
                  onChange={(e) => setScoreAdjustment(parseFloat(e.target.value))}
                  required
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Optional description..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  {editingRule ? "Save" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-2">Delete keyword?</h2>
            <p className="text-sm text-slate-400 mb-4">
              Are you sure you want to delete this keyword rule? This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
