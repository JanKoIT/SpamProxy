"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Mail, Loader2, KeyRound } from "lucide-react";

type Mode = "magic" | "password";

export default function PortalHome() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "sent" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
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

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);
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

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);
    try {
      const res = await fetch("/api/portal/login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace("/portal/quarantine");
      } else {
        setErrMsg("Anmeldedaten ungültig.");
        setState("err");
      }
    } catch {
      setState("err");
      setErrMsg("Verbindungsfehler.");
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
          <>
            <div className="mb-4 flex gap-1 rounded-lg bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => { setMode("magic"); setState("idle"); setErrMsg(null); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "magic" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Magic Link
              </button>
              <button
                type="button"
                onClick={() => { setMode("password"); setState("idle"); setErrMsg(null); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "password" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Passwort
              </button>
            </div>

            {mode === "magic" ? (
              <form onSubmit={handleMagicLink} className="space-y-4">
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
                <p className="text-center text-xs text-slate-500">
                  Einmaliger Anmelde-Link an Ihre E-Mail-Adresse. Kein Passwort nötig.
                </p>
              </form>
            ) : (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <label className="block text-sm">
                  <span className="text-slate-300">E-Mail-Adresse</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    placeholder="ihre.adresse@firma.de"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Passwort</span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={state === "loading" || !email.includes("@") || !password}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {state === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Anmelden
                </button>
                <p className="text-center text-xs text-slate-500">
                  Passwort wird vom Administrator vergeben. Nach dem ersten Login
                  können Sie es unter „Konto&quot; ändern.
                </p>
              </form>
            )}

            {errMsg && (
              <p className="mt-3 text-center text-sm text-red-400">{errMsg}</p>
            )}
            {state === "err" && !errMsg && (
              <p className="mt-3 text-center text-sm text-red-400">
                Fehler bei der Anmeldung. Bitte später erneut versuchen.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
