"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Loader2, Save, Building2 } from "lucide-react";

const REPORT_KEYS = [
  "daily_report_enabled",
  "daily_report_hour",
  "daily_report_from",
  "daily_report_subject",
  "public_base_url",
] as const;

const COMPANY_KEYS = [
  "company_name",
  "company_address",
  "company_email",
  "company_phone",
  "company_website",
  "company_imprint_url",
  "company_privacy_url",
] as const;

type FieldMeta = { label: string; help: string; placeholder?: string; type?: "bool" | "number" | "text" };

const LABELS: Record<string, FieldMeta> = {
  daily_report_enabled: { label: "Daily Reports aktivieren", help: "Globaler Schalter für tägliche Spam-Quarantäne-Reports an Empfänger.", type: "bool" },
  daily_report_hour: { label: "Versandzeit (Stunde)", help: "Stunde (0-23 lokale Zeit), zu der Reports verschickt werden.", placeholder: "7", type: "number" },
  daily_report_from: { label: "Absender-Adresse", help: "E-Mail-Adresse, von der Reports gesendet werden. Muss von Ihrer Domain stammen (SPF/DKIM).", placeholder: "spamproxy@beispiel.de" },
  daily_report_subject: { label: "Betreff-Vorlage", help: "Platzhalter: {count} wird durch die Anzahl der Quarantäne-Nachrichten ersetzt.", placeholder: "Ihre Spam-Quarantäne: {count} neue Nachrichten" },
  public_base_url: { label: "Öffentliche Basis-URL", help: "URL, unter der die SpamProxy-Webseite öffentlich erreichbar ist. Wird in Approve/Reject-Links verwendet.", placeholder: "https://spamproxy.beispiel.de" },

  company_name: { label: "Firmenname", help: "Erscheint im Footer und als Display-Name im Absender. Pflicht für saubere Zustellbarkeit.", placeholder: "Muster GmbH" },
  company_address: { label: "Postanschrift", help: "Vollständige Anschrift in einer Zeile.", placeholder: "Musterstraße 1, 12345 Musterstadt" },
  company_email: { label: "Kontakt-E-Mail", help: "Wird als Reply-To-Header und im Footer angezeigt.", placeholder: "support@beispiel.de" },
  company_phone: { label: "Telefon", help: "Optional. Erscheint im Footer.", placeholder: "+49 30 1234567" },
  company_website: { label: "Webseite", help: "Optional. Erscheint im Footer.", placeholder: "https://beispiel.de" },
  company_imprint_url: { label: "Impressum-URL", help: "Direktlink zum Impressum.", placeholder: "https://beispiel.de/impressum" },
  company_privacy_url: { label: "Datenschutz-URL", help: "Direktlink zur Datenschutzerklärung.", placeholder: "https://beispiel.de/datenschutz" },
};

export default function ReportSettingsPage() {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const next: Record<string, unknown> = {};
        for (const s of data.settings ?? []) {
          next[s.key] = s.value;
        }
        setValues(next);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
        <Mail className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Reports &amp; Absender-Angaben</h1>
          <p className="text-sm text-slate-400">
            Konfiguration für tägliche Quarantäne-Reports und Firmenangaben im Footer
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <Section
        title="Daily Report"
        icon={<Mail className="h-5 w-5 text-blue-400" />}
        keys={REPORT_KEYS as unknown as string[]}
        values={values}
        onSave={save}
      />
      <Section
        title="Firmenangaben (Footer)"
        icon={<Building2 className="h-5 w-5 text-emerald-400" />}
        description="Pflicht für Zustellbarkeit: Mailclients filtern anonyme Massen-Mails oft als Spam. Mindestens Firmenname + Postanschrift sollten gesetzt sein."
        keys={COMPANY_KEYS as unknown as string[]}
        values={values}
        onSave={save}
      />
    </div>
  );
}

function Section({ title, icon, description, keys, values, onSave }: {
  title: string;
  icon: React.ReactNode;
  description?: string;
  keys: string[];
  values: Record<string, unknown>;
  onSave: (key: string, value: unknown) => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="mb-4 flex items-start gap-3">
        {icon}
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
        </div>
      </div>
      <div className="space-y-4">
        {keys.map((key) => (
          <FieldRow key={key} settingKey={key} value={values[key]} onSave={onSave} />
        ))}
      </div>
    </div>
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
