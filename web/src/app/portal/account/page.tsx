"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, ArrowLeft, Loader2, CheckCircle } from "lucide-react";

export default function PortalAccount() {
  const router = useRouter();
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/portal/me").then(async (res) => {
      if (!res.ok) {
        router.replace("/portal");
      } else {
        setMe(await res.json());
      }
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPw !== newPw2) {
      setMsg({ type: "err", text: "Die neuen Passwörter stimmen nicht überein." });
      return;
    }
    if (newPw.length < 8) {
      setMsg({ type: "err", text: "Das Passwort muss mindestens 8 Zeichen lang sein." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPw || null,
          new_password: newPw,
        }),
      });
      if (res.ok) {
        setMsg({ type: "ok", text: "Passwort wurde geändert." });
        setCurrentPw("");
        setNewPw("");
        setNewPw2("");
      } else {
        const data = await res.json().catch(() => ({}));
        setMsg({ type: "err", text: data.detail || "Fehler beim Speichern." });
      }
    } finally {
      setSaving(false);
    }
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="h-7 w-7 text-blue-400" />
          <h1 className="text-xl font-bold">Konto</h1>
        </div>
        <Link
          href="/portal/quarantine"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Zur Quarantäne
        </Link>
      </header>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Passwort ändern</h2>
        <p className="mb-4 text-xs text-slate-400">
          Angemeldet als <span className="font-mono text-slate-200">{me.email}</span>
        </p>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-300">Aktuelles Passwort</span>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              placeholder="(leer lassen, wenn noch kein Passwort gesetzt ist)"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Neues Passwort (mind. 8 Zeichen)</span>
            <input
              type="password"
              required
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Neues Passwort bestätigen</span>
            <input
              type="password"
              required
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          <button
            type="submit"
            disabled={saving || newPw.length < 8}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Speichern
          </button>
        </form>

        {msg && (
          <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            msg.type === "ok"
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
