"use client";

import { useState } from "react";
import { Brain, Send, Loader2, CheckCircle, XCircle, Clock, Zap } from "lucide-react";

interface TestResult {
  status: string;
  score?: number;
  reason?: string;
  error?: string;
  elapsed_ms?: number;
  provider?: string;
  model?: string;
}

const PRESETS = [
  {
    name: "Legitimate Business",
    from_addr: "kollege@firma.de",
    subject: "Meeting morgen um 10 Uhr",
    body: "Hallo,\n\nkurze Erinnerung: morgen um 10 Uhr haben wir das Projektmeeting im Konferenzraum 3.\n\nBitte bringt eure Statusberichte mit.\n\nViele Gruesse\nMax",
  },
  {
    name: "Newsletter",
    from_addr: "newsletter@onlineshop.de",
    subject: "20% Rabatt auf alle Artikel!",
    body: "Lieber Kunde,\n\nnur diese Woche erhalten Sie 20% Rabatt auf alle Artikel in unserem Online-Shop!\n\nGutscheincode: SOMMER20\n\nJetzt einkaufen: https://www.onlineshop.de/sale\n\nMit freundlichen Gruessen\nIhr Online-Shop Team\n\nAbmelden: https://www.onlineshop.de/unsubscribe",
  },
  {
    name: "Phishing",
    from_addr: "security@your-bank-secure.com",
    subject: "DRINGEND: Konto gesperrt - Sofortige Verifizierung erforderlich",
    body: "Sehr geehrter Kunde,\n\nWir haben ungewoehnliche Aktivitaeten auf Ihrem Konto festgestellt.\n\nIhr Konto wurde voruebergehend gesperrt. Um es zu entsperren, klicken Sie bitte SOFORT auf den folgenden Link:\n\nhttp://secure-banking-verify.xyz/login\n\nWenn Sie nicht innerhalb von 24 Stunden verifizieren, wird Ihr Konto dauerhaft geschlossen.\n\nIhre Bank",
  },
  {
    name: "Spam/Scam",
    from_addr: "winner@lottery-international.xyz",
    subject: "CONGRATULATIONS! You won $1,000,000!!!",
    body: "Dear Winner,\n\nYou have been RANDOMLY SELECTED to receive $1,000,000.00 USD!!!\n\nTo claim your prize, send the following information:\n- Full Name\n- Bank Account Number\n- Social Security Number\n- Date of Birth\n\nSend to: claims@lottery-international.xyz\n\nACT NOW! This offer expires in 48 hours!\n\nLottery Commission",
  },
  {
    name: "Russischer Spam",
    from_addr: "offer@cheap-meds.ru",
    subject: "Best prices for medications - up to 90% off",
    body: "Hello!\n\nWe offer the best prices on all medications!\n\nViagra, Cialis, and more - up to 90% off retail prices!\n\nNo prescription needed!\n\nOrder now: http://cheap-pharmacy-online.ru/order\n\nFree shipping worldwide!",
  },
];

function scoreColor(score: number): string {
  if (score < 3) return "text-green-400";
  if (score < 5) return "text-yellow-400";
  if (score < 7) return "text-orange-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score < 3) return "border-green-500/30 bg-green-500/10";
  if (score < 5) return "border-yellow-500/30 bg-yellow-500/10";
  if (score < 7) return "border-orange-500/30 bg-orange-500/10";
  return "border-red-500/30 bg-red-500/10";
}

function scoreLabel(score: number): string {
  if (score < 2) return "Sicher legitim";
  if (score < 4) return "Wahrscheinlich legitim";
  if (score < 6) return "Unsicher";
  if (score < 8) return "Wahrscheinlich Spam";
  return "Spam / Phishing";
}

export default function AITestPage() {
  const [fromAddr, setFromAddr] = useState("test@example.com");
  const [toAddr, setToAddr] = useState("user@example.com");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function runTest() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_addr: fromAddr,
          to_addr: toAddr,
          subject,
          body,
        }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({
        status: "error",
        error: e instanceof Error ? e.message : "Verbindungsfehler",
      });
    } finally {
      setLoading(false);
    }
  }

  function loadPreset(idx: number) {
    const p = PRESETS[idx];
    setFromAddr(p.from_addr);
    setSubject(p.subject);
    setBody(p.body);
    setResult(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-purple-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">AI Spam-Test</h1>
          <p className="text-sm text-slate-400">
            Teste die KI-Klassifizierung mit einer Test-E-Mail
          </p>
        </div>
      </div>

      {/* Presets */}
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-300">
          Vorlagen
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.name}
              type="button"
              onClick={() => loadPreset(i)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Absender
            </label>
            <input
              value={fromAddr}
              onChange={(e) => setFromAddr(e.target.value)}
              placeholder="sender@example.com"
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Empf&auml;nger
            </label>
            <input
              value={toAddr}
              onChange={(e) => setToAddr(e.target.value)}
              placeholder="recipient@example.com"
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Betreff
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="E-Mail Betreff"
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Inhalt
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="E-Mail Text..."
              rows={8}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={runTest}
            disabled={loading || !subject || !body}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {loading ? "Analysiere..." : "KI-Analyse starten"}
          </button>
        </div>

        {/* Result */}
        <div>
          {result ? (
            <div className="space-y-4">
              {result.status === "ok" && result.score !== undefined ? (
                <>
                  {/* Score Display */}
                  <div
                    className={`rounded-xl border p-6 ${scoreBg(result.score)}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-400">Spam-Score</p>
                        <p
                          className={`text-5xl font-bold ${scoreColor(result.score)}`}
                        >
                          {result.score.toFixed(1)}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-300">
                          {scoreLabel(result.score)}
                        </p>
                      </div>
                      <div>
                        {result.score < 5 ? (
                          <CheckCircle className="h-16 w-16 text-green-400/30" />
                        ) : (
                          <XCircle className="h-16 w-16 text-red-400/30" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                    <p className="mb-1 text-xs font-medium uppercase text-slate-500">
                      Begr&uuml;ndung
                    </p>
                    <p className="text-sm text-slate-300">{result.reason}</p>
                  </div>

                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Clock className="h-4 w-4" />
                        <span className="text-xs">Dauer</span>
                      </div>
                      <p className="mt-1 text-lg font-semibold text-white">
                        {result.elapsed_ms} ms
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Zap className="h-4 w-4" />
                        <span className="text-xs">Modell</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {result.provider} / {result.model}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                /* Error */
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-8 w-8 text-red-400" />
                    <div>
                      <p className="font-medium text-red-400">Fehler</p>
                      <p className="mt-1 text-sm text-red-300">
                        {result.error}
                      </p>
                    </div>
                  </div>
                  {result.elapsed_ms !== undefined && (
                    <p className="mt-3 text-xs text-red-400/60">
                      Nach {result.elapsed_ms} ms
                      {result.provider && ` (${result.provider}/${result.model})`}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-700 p-12">
              <div className="text-center">
                <Brain className="mx-auto h-12 w-12 text-slate-700" />
                <p className="mt-3 text-sm text-slate-500">
                  W&auml;hle eine Vorlage oder schreibe eine Test-Mail
                  und klicke &quot;KI-Analyse starten&quot;
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
