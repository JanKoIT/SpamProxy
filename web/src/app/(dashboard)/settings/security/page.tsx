"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  Globe,
  Brain,
  Key,
  Loader2,
  ExternalLink,
  Mail,
  Users,
} from "lucide-react";

interface SettingValue {
  key: string;
  value: unknown;
}

interface ToggleCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  settingKey: string;
  value: boolean;
  loading: boolean;
  onToggle: (key: string, newValue: boolean) => void;
  extra?: React.ReactNode;
}

function ToggleCard({
  icon,
  title,
  description,
  settingKey,
  value,
  loading,
  onToggle,
  extra,
}: ToggleCardProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0">{icon}</div>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{description}</p>
            {extra}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(settingKey, !value)}
          disabled={loading}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            value ? "bg-blue-600" : "bg-slate-700"
          } ${loading ? "opacity-50" : ""}`}
          title={value ? "Disable" : "Enable"}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              value ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

interface InputCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  settingKey: string;
  value: string;
  loading: boolean;
  onSave: (key: string, newValue: string) => void;
  placeholder?: string;
}

function InputCard({
  icon,
  title,
  description,
  settingKey,
  value,
  loading,
  onSave,
  placeholder,
}: InputCardProps) {
  const [localValue, setLocalValue] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocalValue(value);
    setDirty(false);
  }, [value]);

  function handleChange(v: string) {
    setLocalValue(v);
    setDirty(v !== value);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={localValue}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => onSave(settingKey, localValue)}
              disabled={loading || !dirty}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Error loading settings");
      const data: SettingValue[] = await res.json();
      const map: Record<string, unknown> = {};
      for (const s of data) {
        map[s.key] = s.value;
      }
      setSettings(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleToggle(key: string, newValue: boolean) {
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch(`/api/settings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) throw new Error("Error saving");
      setSettings((prev) => ({ ...prev, [key]: newValue }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSaveInput(key: string, newValue: string) {
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch(`/api/settings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) throw new Error("Error saving");
      setSettings((prev) => ({ ...prev, [key]: newValue }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSavingKey(null);
    }
  }

  function boolVal(key: string): boolean {
    const v = settings[key];
    return v === true || v === "true";
  }

  function numVal(key: string, fallback: number): string {
    const v = settings[key];
    if (v === undefined || v === null || v === "") return String(fallback);
    return String(v);
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Security &amp; Scanning</h1>
          <p className="text-sm text-slate-400">
            Configure security and scanning options
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Scoring Thresholds */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex items-start gap-4">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">Scoring Thresholds</h3>
              <p className="mt-1 text-sm text-slate-400">
                Final score at which mail is quarantined vs. rejected. Reject
                must be higher than quarantine. Scores above reject×1.5 are
                silently discarded to protect your reputation.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InputCard
              icon={<Shield className="h-4 w-4 text-yellow-400" />}
              title="Quarantine Threshold"
              description="Score ≥ this value → quarantined for user review"
              settingKey="spam_quarantine_threshold"
              value={numVal("spam_quarantine_threshold", 5.0)}
              loading={savingKey === "spam_quarantine_threshold"}
              onSave={handleSaveInput}
              placeholder="5.0"
            />
            <InputCard
              icon={<Shield className="h-4 w-4 text-red-400" />}
              title="Reject Threshold"
              description="Score ≥ this value → rejected (bounced)"
              settingKey="spam_reject_threshold"
              value={numVal("spam_reject_threshold", 10.0)}
              loading={savingKey === "spam_reject_threshold"}
              onSave={handleSaveInput}
              placeholder="10.0"
            />
          </div>
        </div>

        {/* Auto-learn rejected as spam */}
        <ToggleCard
          icon={<Brain className="h-5 w-5 text-purple-400" />}
          title="Auto-learn rejected mail as spam"
          description="When mail is rejected or discarded, teach rspamd's Bayes classifier so future mails with similar patterns get caught earlier."
          settingKey="auto_learn_rejected_spam"
          value={boolVal("auto_learn_rejected_spam")}
          loading={savingKey === "auto_learn_rejected_spam"}
          onToggle={handleToggle}
        />

        {/* Virus Scanning */}
        <ToggleCard
          icon={<Shield className="h-5 w-5 text-red-400" />}
          title="Virus-Scanning (ClamAV)"
          description="Scans emails for viruses and malware via ClamAV"
          settingKey="antivirus_enabled"
          value={boolVal("antivirus_enabled")}
          loading={savingKey === "antivirus_enabled"}
          onToggle={handleToggle}
        />

        {/* DNS Blocklists */}
        <ToggleCard
          icon={<Globe className="h-5 w-5 text-yellow-400" />}
          title="DNS Blocklists (RBL/DNSBL)"
          description="Checks sender IPs against DNS blocklists like Spamhaus, Barracuda, SpamCop"
          settingKey="rbl_enabled"
          value={boolVal("rbl_enabled")}
          loading={savingKey === "rbl_enabled"}
          onToggle={handleToggle}
        />

        {/* SPF Verification */}
        <ToggleCard
          icon={<Shield className="h-5 w-5 text-green-400" />}
          title="SPF Verification"
          description="Checks SPF records of the sender domain"
          settingKey="spf_enabled"
          value={boolVal("spf_enabled")}
          loading={savingKey === "spf_enabled"}
          onToggle={handleToggle}
        />

        {/* Spamhaus DQS */}
        <InputCard
          icon={<Shield className="h-5 w-5 text-orange-400" />}
          title="Spamhaus DQS"
          description="Spamhaus Data Query Service for extended blocklist queries"
          settingKey="spamhaus_dqs_key"
          value={String(settings["spamhaus_dqs_key"] ?? "")}
          loading={savingKey === "spamhaus_dqs_key"}
          onSave={handleSaveInput}
          placeholder="Enter DQS API key"
        />

        {/* AI Spam Classification */}
        <ToggleCard
          icon={<Brain className="h-5 w-5 text-purple-400" />}
          title="AI Spam Classification"
          description="AI-based spam detection for grey-zone emails"
          settingKey="ai_enabled"
          value={boolVal("ai_enabled")}
          loading={savingKey === "ai_enabled"}
          onToggle={handleToggle}
        />

        {/* AI First Sender Scan */}
        <ToggleCard
          icon={<Brain className="h-5 w-5 text-cyan-400" />}
          title="AI Scan First-Time Senders"
          description="Force AI classification for every first-time sender, regardless of rspamd score. Catches phishing and spam from unknown senders that bypasses rule-based detection."
          settingKey="ai_scan_first_sender"
          value={boolVal("ai_scan_first_sender")}
          loading={savingKey === "ai_scan_first_sender"}
          onToggle={handleToggle}
        />

        {/* Google Groups Blocking */}
        <ToggleCard
          icon={<Users className="h-5 w-5 text-orange-400" />}
          title="Google Groups Spam"
          description="Blocks spam from Google Groups (freemail senders via Groups get +6.0 score)"
          settingKey="block_google_groups"
          value={boolVal("block_google_groups")}
          loading={savingKey === "block_google_groups"}
          onToggle={handleToggle}
        />

        {/* Bulk Unsolicited */}
        <ToggleCard
          icon={<Mail className="h-5 w-5 text-yellow-400" />}
          title="Bulk Mail Blocking"
          description="Blocks unsolicited bulk mail without proper List-Id header (+3.0 score)"
          settingKey="block_bulk_unsolicited"
          value={boolVal("block_bulk_unsolicited")}
          loading={savingKey === "block_bulk_unsolicited"}
          onToggle={handleToggle}
        />

        {/* Sender Auth Enforcement */}
        <ToggleCard
          icon={<Shield className="h-5 w-5 text-cyan-400" />}
          title="Sender Authentication Scoring"
          description="Penalizes mail from servers without reverse DNS, DKIM or SPF. Missing rDNS +4.0, SPF fail +3.0, DKIM fail +3.0, all missing +3.0 extra."
          settingKey="reject_auth_failures"
          value={boolVal("reject_auth_failures")}
          loading={savingKey === "reject_auth_failures"}
          onToggle={handleToggle}
        />

        {/* Hard reject: no rDNS */}
        <ToggleCard
          icon={<Globe className="h-5 w-5 text-red-400" />}
          title="Reject: No Reverse DNS"
          description="Hard-reject mail from servers without reverse DNS (PTR record). Legitimate mail servers always have rDNS configured."
          settingKey="reject_no_rdns"
          value={boolVal("reject_no_rdns")}
          loading={savingKey === "reject_no_rdns"}
          onToggle={handleToggle}
        />

        {/* Hard reject: no SPF */}
        <ToggleCard
          icon={<Shield className="h-5 w-5 text-red-400" />}
          title="Reject: No SPF / SPF Fail"
          description="Hard-reject mail from domains without SPF record or with SPF hard fail. Warning: some smaller domains may not have SPF configured."
          settingKey="reject_no_spf"
          value={boolVal("reject_no_spf")}
          loading={savingKey === "reject_no_spf"}
          onToggle={handleToggle}
        />

        {/* DKIM Signing */}
        <ToggleCard
          icon={<Key className="h-5 w-5 text-blue-400" />}
          title="DKIM Signing"
          description="DKIM signing for outgoing emails"
          settingKey="dkim_signing_enabled"
          value={boolVal("dkim_signing_enabled")}
          loading={savingKey === "dkim_signing_enabled"}
          onToggle={handleToggle}
          extra={
            <Link
              href="/settings/dkim"
              className="mt-2 inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Manage DKIM keys
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          }
        />
      </div>
    </div>
  );
}
