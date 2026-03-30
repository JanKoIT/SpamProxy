"use client";

import { useState } from "react";
import type { Setting } from "@/lib/api";
import { Pencil, Check, X, Loader2 } from "lucide-react";

const API_BASE = "/api";

export function SettingRow({ setting }: { setting: Setting }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(formatValue(setting.value));
  const [saving, setSaving] = useState(false);
  const [currentValue, setCurrentValue] = useState(setting.value);
  const [error, setError] = useState<string | null>(null);

  function formatValue(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  }

  function parseValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "") return "";
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== "") return num;
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  function getInputType(): string {
    if (typeof currentValue === "boolean") return "toggle";
    if (typeof currentValue === "number") return "number";
    if (typeof currentValue === "object" && currentValue !== null) return "textarea";
    const str = String(currentValue ?? "");
    if (str.length > 60) return "textarea";
    return "text";
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const parsed = parseValue(value);
      const res = await fetch(`${API_BASE}/settings/${encodeURIComponent(setting.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: parsed }),
      });
      if (!res.ok) throw new Error("Failed to update setting");
      setCurrentValue(parsed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    const newVal = !currentValue;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/settings/${encodeURIComponent(setting.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newVal }),
      });
      if (!res.ok) throw new Error("Failed to update setting");
      setCurrentValue(newVal);
      setValue(String(newVal));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const inputType = getInputType();

  return (
    <div className="flex items-start justify-between gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-mono text-blue-400">
            {setting.key}
          </code>
        </div>
        {setting.description && (
          <p className="mt-1 text-sm text-slate-400">{setting.description}</p>
        )}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        {inputType === "toggle" ? (
          <button
            type="button"
            onClick={handleToggle}
            disabled={saving}
            title={`Toggle ${setting.key}`}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
              currentValue ? "bg-blue-600" : "bg-slate-700"
            } ${saving ? "opacity-50" : ""}`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                currentValue ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        ) : editing ? (
          <div className="flex items-center gap-2">
            {inputType === "textarea" ? (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={3}
                aria-label={`Value for ${setting.key}`}
                className="w-64 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-mono text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            ) : (
              <input
                type={inputType}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={`Value for ${setting.key}`}
                className="w-48 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-mono text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              title="Save"
              className="rounded-md p-1.5 text-green-400 hover:bg-green-500/20 transition-colors"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue(formatValue(currentValue));
                setError(null);
              }}
              title="Cancel"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-mono text-slate-300">
              {formatValue(currentValue) || <span className="text-slate-600">empty</span>}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
