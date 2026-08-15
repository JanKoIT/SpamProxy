"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Save, ShieldAlert, RefreshCw } from "lucide-react";

type FieldMeta = {
  label: string;
  help: string;
  placeholder?: string;
  type?: "bool" | "number" | "text" | "select";
  options?: { value: string; label: string }[];
};

const KEYS = [
  "safelinks_enabled",
  "safelinks_domain_scope",
  "safelinks_mode",
  "safelinks_rewrite_plaintext",
  "safelinks_trusted_domains",
  "safelinks_ttl_days",
  "safelinks_check_surbl",
  "safelinks_scan_google_sb",
  "safelinks_google_sb_api_key",
  "safelinks_scan_virustotal",
  "safelinks_virustotal_api_key",
  "safelinks_virustotal_min_detections",
  "safelinks_resolve_redirects",
] as const;

const TEXT_KEYS = [
  "safelinks_interstitial_title",
  "safelinks_interstitial_text",
  "safelinks_button_label",
  "safelinks_block_title",
  "safelinks_block_text",
] as const;

const LABELS: Record<string, FieldMeta> = {
  safelinks_enabled: {
    label: "Safe Links aktivieren",
    help: "Schreibt Links in eingehenden Mails um, sodass jeder Klick zur Prüfung über SpamProxy läuft. Nur eingehende, zugestellte Mail wird verändert.",
    type: "bool",
  },
  safelinks_domain_scope: {
    label: "Geltungsbereich",
    help: "Für welche Empfänger-Domains Safe Links greift. Bei „Nur ausgewählte“ werden nur die unten markierten Domains geschützt.",
    type: "select",
    options: [
      { value: "all", label: "Alle Domains" },
      { value: "selected", label: "Nur ausgewählte Domains" },
    ],
  },
  safelinks_mode: {
    label: "Klick-Verhalten",
    help: "Interstitial: bei jedem Klick wird das echte Ziel angezeigt. Silent: saubere Links leiten sofort weiter, nur Verdächtiges zeigt eine Seite.",
    type: "select",
    options: [
      { value: "interstitial", label: "Immer Zwischenseite zeigen" },
      { value: "silent", label: "Saubere Links sofort weiterleiten" },
    ],
  },
  safelinks_rewrite_plaintext: {
    label: "Auch Plaintext umschreiben",
    help: "Neben HTML-Links auch nackte URLs in reinen Text-Mails schützen.",
    type: "bool",
  },
  safelinks_trusted_domains: {
    label: "Vertrauenswürdige Domains",
    help: "Diese Domains werden nicht umgeschrieben (kommagetrennt). Subdomains sind eingeschlossen. Beispiel: firma.de, sharepoint.com",
    placeholder: "firma.de, intranet.local",
  },
  safelinks_ttl_days: {
    label: "Gültigkeit (Tage)",
    help: "Wie lange ein umgeschriebener Safe-Link nach Zustellung klickbar bleibt.",
    placeholder: "30",
    type: "number",
  },
  safelinks_check_surbl: {
    label: "SURBL/DBL-Prüfung",
    help: "Beim Klick das Ziel zusätzlich gegen Spamhaus DBL / SURBL prüfen (DNS-Lookup).",
    type: "bool",
  },
  safelinks_scan_google_sb: {
    label: "Google Safe Browsing",
    help: "Echtes Link-Scanning: prüft das Ziel beim Klick live gegen Googles Threat-Listen (Malware, Phishing, unerwünschte Software). Benötigt einen API-Key.",
    type: "bool",
  },
  safelinks_google_sb_api_key: {
    label: "Safe Browsing API-Key",
    help: "Google-Cloud-API-Key mit aktivierter „Safe Browsing API“. Pflicht, wenn Safe Browsing aktiv ist.",
    placeholder: "AIza…",
  },
  safelinks_scan_virustotal: {
    label: "VirusTotal",
    help: "Zusätzliches Scanning: schlägt das Ziel beim Klick in VirusTotal nach (70+ Engines). Benötigt einen API-Key. Öffentlicher Key ist auf 4 Anfragen/Min. limitiert.",
    type: "bool",
  },
  safelinks_virustotal_api_key: {
    label: "VirusTotal API-Key",
    help: "Dein VirusTotal-API-Key (v3). Pflicht, wenn VirusTotal aktiv ist.",
    placeholder: "64-stelliger Key",
  },
  safelinks_virustotal_min_detections: {
    label: "VT-Schwellwert",
    help: "Ab wie vielen Engines, die die URL als bösartig melden, blockiert wird. Darunter (aber >0) nur Warnhinweis. Empfohlen: 2.",
    placeholder: "2",
    type: "number",
  },
  safelinks_resolve_redirects: {
    label: "Weiterleitungen auflösen",
    help: "Folgt URL-Shortenern/Weiterleitungen bis zum echten Ziel und scannt auch dieses (Anti-Cloaking). Interne/private Ziele werden blockiert (SSRF-Schutz).",
    type: "bool",
  },

  safelinks_interstitial_title: {
    label: "Überschrift (Zwischenseite)",
    help: "Titel der Seite, die beim Klick angezeigt wird. Leer = eingebauter Standardtext.",
    placeholder: "Sie verlassen den geschützten Bereich",
  },
  safelinks_interstitial_text: {
    label: "Text (Zwischenseite)",
    help: "Einleitungstext über der Ziel-Adresse.",
    placeholder: "Sie werden zu folgender Adresse weitergeleitet …",
  },
  safelinks_button_label: {
    label: "Button-Beschriftung",
    help: "Text des Weiter-Buttons auf der Zwischenseite.",
    placeholder: "Weiter zur Seite",
  },
  safelinks_block_title: {
    label: "Überschrift (Blockseite)",
    help: "Titel der Seite, wenn ein Link als gefährlich blockiert wird.",
    placeholder: "Gefährlicher Link blockiert",
  },
  safelinks_block_text: {
    label: "Text (Blockseite)",
    help: "Meldung auf der Blockseite.",
    placeholder: "SpamProxy hat das Ziel dieses Links als gefährlich eingestuft …",
  },
};

type Click = {
  url: string;
  host: string;
  verdict: string;
  proceeded: boolean;
  created_at: string;
};

export default function SafeLinksSettingsPage() {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clicks, setClicks] = useState<Click[]>([]);
  const [domains, setDomains] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/settings?category=safelinks", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.settings ?? []);
        const next: Record<string, unknown> = {};
        for (const s of list) next[s.key] = s.value;
        setValues(next);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClicks = useCallback(async () => {
    try {
      const res = await fetch("/api/safelinks/clicks?limit=100", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setClicks(data.clicks ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/domains", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.domains ?? []);
        setDomains(list.map((d: { domain: string }) => d.domain).filter(Boolean));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => { reload(); loadClicks(); loadDomains(); }, [reload, loadClicks, loadDomains]);

  async function save(key: string, value: unknown) {
    setError(null);
    try {
      const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Fehler beim Speichern");
      setValues((prev) => ({ ...prev, [key]: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link2 className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Safe Links</h1>
          <p className="text-sm text-slate-400">
            Links in eingehenden Mails werden umgeschrieben und beim Klick auf Bedrohungen geprüft
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 flex gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Setzen Sie die <strong>Öffentliche Basis-URL</strong> unter „Reports &amp; Footer&quot; korrekt,
          da die umgeschriebenen Links darauf zeigen. Das Umschreiben verändert den Mail-Body und
          bricht die DKIM-Signatur des Absenders — das ist unkritisch, weil rspamd DKIM/SPF/DMARC
          davor prüft.
        </span>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="space-y-4">
          {KEYS.map((key) => (
            <FieldRow key={key} settingKey={key} value={values[key]} onSave={save} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-base font-semibold text-white mb-1">Texte der Klick-Seiten</h2>
        <p className="text-xs text-slate-500 mb-4">
          Beschriftungen der Zwischen- und Blockseite, die dem Empfänger beim Klick angezeigt werden. Leer = eingebauter Standardtext.
        </p>
        <div className="space-y-4">
          {TEXT_KEYS.map((key) => (
            <FieldRow key={key} settingKey={key} value={values[key]} onSave={save} />
          ))}
        </div>
      </div>

      {(values.safelinks_domain_scope ?? "all") === "selected" && (
        <DomainPicker
          domains={domains}
          selected={
            Array.isArray(values.safelinks_domains)
              ? (values.safelinks_domains as string[])
              : []
          }
          onSave={(next) => save("safelinks_domains", next)}
        />
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Letzte Klicks</h2>
          <button
            type="button"
            onClick={loadClicks}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Aktualisieren
          </button>
        </div>
        {clicks.length === 0 ? (
          <p className="text-sm text-slate-500">Noch keine Klicks erfasst.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Zeit</th>
                  <th className="py-2 pr-4">Host</th>
                  <th className="py-2 pr-4">Bewertung</th>
                  <th className="py-2 pr-4">Weiter</th>
                </tr>
              </thead>
              <tbody>
                {clicks.map((c, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
                      {new Date(c.created_at).toLocaleString("de-DE")}
                    </td>
                    <td className="py-2 pr-4 text-slate-200 max-w-[260px] truncate" title={c.url}>
                      {c.host}
                    </td>
                    <td className="py-2 pr-4">
                      <VerdictBadge verdict={c.verdict} />
                    </td>
                    <td className="py-2 pr-4 text-slate-400">{c.proceeded ? "ja" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DomainPicker({ domains, selected, onSave }: {
  domains: string[];
  selected: string[];
  onSave: (next: string[]) => Promise<void>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  // Show known domains plus any selected domain no longer in the domains table.
  const all = Array.from(new Set([...domains, ...selected])).sort();

  async function toggle(domain: string) {
    const next = selected.includes(domain)
      ? selected.filter((d) => d !== domain)
      : [...selected, domain];
    setSaving(domain);
    try {
      await onSave(next);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-base font-semibold text-white mb-1">Geschützte Domains</h2>
      <p className="text-xs text-slate-500 mb-4">
        Nur Mail an Empfänger dieser Domains wird umgeschrieben. Subdomains sind eingeschlossen.
      </p>
      {all.length === 0 ? (
        <p className="text-sm text-slate-500">
          Keine Domains gefunden. Legen Sie zuerst unter „Domains“ Ihre Empfänger-Domains an.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {all.map((domain) => {
            const checked = selected.includes(domain);
            const unknown = !domains.includes(domain);
            return (
              <label
                key={domain}
                className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white cursor-pointer hover:bg-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={saving === domain}
                  onChange={() => toggle(domain)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className={unknown ? "text-slate-400" : ""}>
                  {domain}
                  {unknown && <span className="ml-2 text-xs text-slate-500">(nicht in Domains-Liste)</span>}
                </span>
                {saving === domain && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, string> = {
    clean: "bg-emerald-500/15 text-emerald-400",
    suspicious: "bg-amber-500/15 text-amber-400",
    malicious: "bg-red-500/15 text-red-400",
  };
  const labels: Record<string, string> = {
    clean: "sauber",
    suspicious: "verdächtig",
    malicious: "blockiert",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${map[verdict] ?? "bg-slate-700 text-slate-300"}`}>
      {labels[verdict] ?? verdict}
    </span>
  );
}

function FieldRow({ settingKey, value, onSave }: {
  settingKey: string;
  value: unknown;
  onSave: (key: string, value: unknown) => Promise<void>;
}) {
  const meta = LABELS[settingKey];
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  async function handleSave(v: unknown) {
    setSaving(true);
    try {
      await onSave(settingKey, v);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  let control: React.ReactNode;
  if (meta?.type === "bool") {
    const v = value === true || value === "true";
    control = (
      <button
        type="button"
        onClick={() => handleSave(!v)}
        disabled={saving}
        title={v ? "Deaktivieren" : "Aktivieren"}
        aria-label={v ? "Deaktivieren" : "Aktivieren"}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${v ? "bg-blue-600" : "bg-slate-700"}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${v ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    );
  } else if (meta?.type === "select") {
    control = (
      <select
        value={String(value ?? meta.options?.[0]?.value ?? "")}
        onChange={(e) => handleSave(e.target.value)}
        disabled={saving}
        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
      >
        {meta.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  } else {
    const dirty = draft !== (value == null ? "" : String(value));
    control = (
      <div className="flex gap-2">
        <input
          type={meta?.type === "number" ? "number" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={meta?.placeholder}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
        />
        <button
          type="button"
          onClick={() => handleSave(meta?.type === "number" ? Number(draft) : draft)}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40 hover:bg-blue-700"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? "Gespeichert" : "Speichern"}
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[220px_1fr] sm:gap-4">
      <div>
        <div className="text-sm font-medium text-white">{meta?.label ?? settingKey}</div>
        {meta?.help && <div className="text-xs text-slate-500 mt-0.5">{meta.help}</div>}
      </div>
      <div>{control}</div>
    </div>
  );
}
