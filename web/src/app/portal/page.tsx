"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Mail, Loader2 } from "lucide-react";

export default function PortalHome() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "sent" | "err">("idle");
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch("/api/portal/me").then(async (res) => {
      if (res.ok) {
        router.replace("/portal/quarantine");
      } else {
        setCheckingSession(false);
      }
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    try {
      const res = await fetch("/api/portal/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? "sent" : "err");
    } catch {
      setState("err");
    }
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <Shield className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-xl font-bold">Ihre Spam-Quarantäne</h1>
            <p className="text-sm text-slate-400">
              Sie wollen öfter schauen? Registrieren Sie sich hier.
            </p>
          </div>
        </div>

        {state === "sent" ? (
          <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-6 text-center">
            <Mail className="mx-auto mb-3 h-8 w-8 text-green-400" />
            <p className="text-sm text-green-200">
              Wir haben Ihnen einen Login-Link per E-Mail geschickt (falls die
              Adresse bei uns hinterlegt ist).
            </p>
            <p className="mt-2 text-xs text-green-300/70">
              Der Link ist 15 Minuten gültig.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="text-slate-300">E-Mail-Adresse Ihres Postfachs</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ihre.adresse@firma.de"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={state === "loading" || !email.includes("@")}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {state === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Login-Link senden
            </button>
            {state === "err" && (
              <p className="text-center text-sm text-red-400">
                Fehler beim Senden. Bitte später erneut versuchen.
              </p>
            )}
            <p className="text-center text-xs text-slate-500">
              Wir senden einen einmaligen Anmelde-Link an Ihre E-Mail-Adresse.
              Kein Passwort erforderlich.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
