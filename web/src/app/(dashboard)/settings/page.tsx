export const dynamic = "force-dynamic";

import { fetchSettings } from "@/lib/api";
import type { Setting } from "@/lib/api";
import { Settings, Shield, Brain, Archive, Mail } from "lucide-react";
import { SettingRow } from "./setting-row";

const CATEGORY_META: Record<string, { label: string; icon: string; description: string }> = {
  scanning: {
    label: "Scanning",
    icon: "shield",
    description: "Configure spam scanning thresholds and behavior",
  },
  ai: {
    label: "AI Analysis",
    icon: "brain",
    description: "AI-powered content analysis settings",
  },
  quarantine: {
    label: "Quarantine",
    icon: "archive",
    description: "Quarantine storage and notification settings",
  },
  smtp: {
    label: "SMTP",
    icon: "mail",
    description: "SMTP server configuration",
  },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  shield: <Shield className="h-5 w-5 text-blue-400" />,
  brain: <Brain className="h-5 w-5 text-purple-400" />,
  archive: <Archive className="h-5 w-5 text-yellow-400" />,
  mail: <Mail className="h-5 w-5 text-green-400" />,
};

export default async function SettingsPage() {
  const settings = await fetchSettings();

  // Group by category
  const grouped: Record<string, Setting[]> = {};
  for (const s of settings) {
    const cat = s.category || "general";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  }

  // Order categories: known ones first, then any extras
  const knownCategories = ["scanning", "ai", "quarantine", "smtp"];
  const allCategories = [
    ...knownCategories.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !knownCategories.includes(c)),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-slate-400" />
        <h1 className="text-2xl font-bold text-white">Settings</h1>
      </div>

      {allCategories.map((cat) => {
        const meta = CATEGORY_META[cat] ?? {
          label: cat.charAt(0).toUpperCase() + cat.slice(1),
          icon: "shield",
          description: "",
        };

        return (
          <section key={cat} className="rounded-lg border border-slate-800 bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-4">
              {CATEGORY_ICONS[meta.icon] ?? CATEGORY_ICONS.shield}
              <div>
                <h2 className="text-lg font-semibold text-white">{meta.label}</h2>
                {meta.description && (
                  <p className="text-sm text-slate-400">{meta.description}</p>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-800">
              {grouped[cat].map((setting) => (
                <SettingRow key={setting.key} setting={setting} />
              ))}
            </div>
          </section>
        );
      })}

      {allCategories.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 px-6 py-12 text-center text-slate-500">
          No settings found.
        </div>
      )}
    </div>
  );
}
