"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Shield,
  Search,
  ChevronDown,
  ChevronRight,
  Save,
  RotateCcw,
  Loader2,
} from "lucide-react";

interface RspamdSymbol {
  symbol: string;
  weight: number;
  description: string;
  group: string;
}

interface SymbolOverrides {
  [symbol: string]: number;
}

interface EditState {
  [symbol: string]: number;
}

export default function RspamdSymbolsPage() {
  const [symbols, setSymbols] = useState<RspamdSymbol[]>([]);
  const [overrides, setOverrides] = useState<SymbolOverrides>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editScores, setEditScores] = useState<EditState>({});
  const [savingSymbol, setSavingSymbol] = useState<string | null>(null);
  const [resettingSymbol, setResettingSymbol] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [symbolsRes, overridesRes] = await Promise.all([
        fetch("/api/rspamd-symbols"),
        fetch("/api/rspamd-symbols/overrides"),
      ]);
      if (!symbolsRes.ok) throw new Error("Failed to load symbols");
      if (!overridesRes.ok) throw new Error("Failed to load overrides");
      const symbolsData: RspamdSymbol[] = await symbolsRes.json();
      const overridesData: SymbolOverrides = await overridesRes.json();
      setSymbols(symbolsData);
      setOverrides(overridesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredSymbols = symbols.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.symbol.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });

  const grouped = filteredSymbols.reduce<Record<string, RspamdSymbol[]>>(
    (acc, s) => {
      const group = s.group || "ungrouped";
      if (!acc[group]) acc[group] = [];
      acc[group].push(s);
      return acc;
    },
    {}
  );

  const sortedGroups = Object.keys(grouped).sort((a, b) =>
    a.localeCompare(b)
  );

  // Auto-expand groups that match search
  useEffect(() => {
    if (search) {
      setExpandedGroups(new Set(sortedGroups));
    } else {
      setExpandedGroups(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const getEffectiveScore = (s: RspamdSymbol): number => {
    if (s.symbol in editScores) return editScores[s.symbol];
    if (s.symbol in overrides) return overrides[s.symbol];
    return s.weight;
  };

  const hasOverride = (symbol: string): boolean => symbol in overrides;

  const isEdited = (s: RspamdSymbol): boolean => {
    if (!(s.symbol in editScores)) return false;
    const current = hasOverride(s.symbol) ? overrides[s.symbol] : s.weight;
    return editScores[s.symbol] !== current;
  };

  const scoreColor = (score: number): string => {
    if (score > 0) return "text-red-400";
    if (score < 0) return "text-green-400";
    return "text-slate-500";
  };

  const handleScoreChange = (symbol: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setEditScores((prev) => ({ ...prev, [symbol]: num }));
    } else if (value === "" || value === "-") {
      // Allow empty/minus for typing
      setEditScores((prev) => ({ ...prev, [symbol]: 0 }));
    }
  };

  const handleSave = async (s: RspamdSymbol) => {
    const score = editScores[s.symbol];
    if (score === undefined) return;
    setSavingSymbol(s.symbol);
    try {
      const res = await fetch("/api/rspamd-symbols/score", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: s.symbol, score }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setOverrides((prev) => ({ ...prev, [s.symbol]: score }));
      setEditScores((prev) => {
        const next = { ...prev };
        delete next[s.symbol];
        return next;
      });
    } catch {
      setError("Failed to save score for " + s.symbol);
    } finally {
      setSavingSymbol(null);
    }
  };

  const handleReset = async (s: RspamdSymbol) => {
    setResettingSymbol(s.symbol);
    try {
      const res = await fetch("/api/rspamd-symbols/score", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: s.symbol, score: s.weight }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[s.symbol];
        return next;
      });
      setEditScores((prev) => {
        const next = { ...prev };
        delete next[s.symbol];
        return next;
      });
    } catch {
      setError("Failed to reset score for " + s.symbol);
    } finally {
      setResettingSymbol(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Shield className="h-7 w-7 text-blue-500" />
          <h1 className="text-2xl font-bold text-white">rspamd Symbols</h1>
        </div>
        <p className="text-slate-400 ml-10">
          Score adjustments for individual rspamd detection rules
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbols by name or description..."
          className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
        />
      </div>

      {/* Stats */}
      <div className="text-sm text-slate-500">
        {filteredSymbols.length} symbols in {sortedGroups.length} groups
        {search && ` matching "${search}"`}
      </div>

      {/* Groups */}
      <div className="space-y-2">
        {sortedGroups.map((group) => {
          const groupSymbols = grouped[group];
          const isExpanded = expandedGroups.has(group);
          const overrideCount = groupSymbols.filter((s) =>
            hasOverride(s.symbol)
          ).length;

          return (
            <div
              key={group}
              className="bg-slate-900 border border-slate-700/50 rounded-lg overflow-hidden"
            >
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                  <span className="text-white font-medium">{group}</span>
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                    {groupSymbols.length}
                  </span>
                  {overrideCount > 0 && (
                    <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                      {overrideCount} customized
                    </span>
                  )}
                </div>
              </button>

              {/* Group content */}
              {isExpanded && (
                <div className="border-t border-slate-700/50">
                  {groupSymbols
                    .sort((a, b) => a.symbol.localeCompare(b.symbol))
                    .map((s) => {
                      const effective = getEffectiveScore(s);
                      const edited = isEdited(s);
                      const override = hasOverride(s.symbol);
                      const isSaving = savingSymbol === s.symbol;
                      const isResetting = resettingSymbol === s.symbol;

                      return (
                        <div
                          key={s.symbol}
                          className={`flex items-center gap-4 px-4 py-3 border-t border-slate-800 first:border-t-0 hover:bg-slate-800/30 ${
                            override ? "bg-blue-500/5" : ""
                          }`}
                        >
                          {/* Symbol info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-white text-sm">
                                {s.symbol}
                              </span>
                              {override && (
                                <span className="text-[10px] text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded">
                                  custom
                                </span>
                              )}
                            </div>
                            {s.description && (
                              <p className="text-xs text-slate-400 mt-0.5 truncate">
                                {s.description}
                              </p>
                            )}
                          </div>

                          {/* Default score display */}
                          {override && (
                            <div className="text-xs text-slate-600 whitespace-nowrap">
                              default: {s.weight}
                            </div>
                          )}

                          {/* Score input */}
                          <input
                            type="number"
                            step="0.1"
                            value={
                              s.symbol in editScores
                                ? editScores[s.symbol]
                                : override
                                  ? overrides[s.symbol]
                                  : s.weight
                            }
                            onChange={(e) =>
                              handleScoreChange(s.symbol, e.target.value)
                            }
                            className={`w-24 px-2 py-1.5 bg-slate-950 border rounded text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
                              override
                                ? "border-blue-500/40"
                                : "border-slate-700"
                            } ${scoreColor(effective)}`}
                          />

                          {/* Action buttons */}
                          <div className="flex items-center gap-1.5 w-20 justify-end">
                            {edited && (
                              <button
                                onClick={() => handleSave(s)}
                                disabled={isSaving}
                                className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
                                title="Save"
                              >
                                {isSaving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Save className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            {override && !edited && (
                              <button
                                onClick={() => handleReset(s)}
                                disabled={isResetting}
                                className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
                                title="Reset to default"
                              >
                                {isResetting ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sortedGroups.length === 0 && !loading && (
        <div className="text-center text-slate-500 py-12">
          {search
            ? "No symbols matching your search."
            : "No symbols loaded."}
        </div>
      )}
    </div>
  );
}
