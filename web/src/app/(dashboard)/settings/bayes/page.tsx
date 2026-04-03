"use client";

import { useEffect, useState } from "react";
import {
  Brain,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Database,
  Download,
  ExternalLink,
} from "lucide-react";

interface TrainingStatus {
  last_spam_trained: string | null;
  ham_corpus_trained: boolean;
  spam_source: string;
  ham_source: string;
  months_total: number;
  months_trained: number;
  months_remaining: number;
  trained_months: string[];
  rspamd_learned: number;
  rspamd_ham_count: number;
  rspamd_spam_count: number;
}

export default function BayesTrainingPage() {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState<{
    ham_learned: number;
    spam_learned: number;
  } | null>(null);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/bayes-training/status");
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleTrain() {
    setTraining(true);
    setTrainResult(null);
    try {
      const res = await fetch("/api/bayes-training/train", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTrainResult(data);
        await fetchStatus();
      }
    } finally {
      setTraining(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Bayes Training</h1>
            <p className="text-sm text-slate-400">
              Automatic spam/ham corpus training for rspamd Bayes filter
            </p>
          </div>
        </div>
        <button
          onClick={handleTrain}
          disabled={training}
          className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
        >
          {training ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {training ? "Training..." : "Train Now"}
        </button>
      </div>

      {/* Info */}
      <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-4 py-3 text-sm text-purple-300">
        SpamProxy automatically downloads spam and ham corpora to train the
        rspamd Bayes filter. Spam is sourced from{" "}
        <a
          href="https://untroubled.org/spam/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-purple-200"
        >
          untroubled.org/spam
          <ExternalLink className="inline h-3 w-3 ml-0.5" />
        </a>{" "}
        (monthly archives). Ham is sourced from the Apache SpamAssassin public
        corpus. Training runs automatically once per day.
      </div>

      {/* Train Result */}
      {trainResult && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
          <CheckCircle className="inline h-4 w-4 mr-2" />
          Training complete: {trainResult.spam_learned} spam +{" "}
          {trainResult.ham_learned} ham messages learned
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
        </div>
      ) : status ? (
        <div className="space-y-4">
          {/* rspamd Stats */}
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-4">
              <Database className="h-4 w-4 text-blue-400" />
              rspamd Bayes Statistics
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-slate-800 p-4">
                <p className="text-xs text-slate-400">Total Learned</p>
                <p className="text-2xl font-bold text-white">
                  {status.rspamd_learned.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-slate-800 p-4">
                <p className="text-xs text-slate-400">Ham Messages</p>
                <p className="text-2xl font-bold text-green-400">
                  {status.rspamd_ham_count.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-slate-800 p-4">
                <p className="text-xs text-slate-400">Spam Messages</p>
                <p className="text-2xl font-bold text-red-400">
                  {status.rspamd_spam_count.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Training Progress */}
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
              <XCircle className="h-4 w-4 text-red-400" />
              Spam Corpus Training Progress
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">
                  {status.months_trained} / {status.months_total} months trained
                </span>
                <span className="text-white font-mono">
                  {status.months_total > 0
                    ? Math.round((status.months_trained / status.months_total) * 100)
                    : 0}%
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-500 to-purple-500 transition-all"
                  style={{
                    width: `${status.months_total > 0
                      ? (status.months_trained / status.months_total) * 100
                      : 0}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Jan 2024</span>
                <span>
                  {status.months_remaining > 0
                    ? `${status.months_remaining} months remaining (3 per run)`
                    : "All months complete"}
                </span>
                <span>Present</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>Source:</span>
                <a
                  href="https://untroubled.org/spam/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  untroubled.org/spam
                </a>
                <span className="text-slate-600">|</span>
                <span>Last: {status.last_spam_trained || "Never"}</span>
                <span className="text-slate-600">|</span>
                <span>~500 msgs/month</span>
              </div>
            </div>
          </div>

          {/* Training Sources */}
          <div className="grid grid-cols-2 gap-4">
            {/* Trained Months */}
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-sm font-semibold text-white mb-3">
                Trained Months
              </h3>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {status.trained_months.length > 0 ? (
                  status.trained_months.map((m) => (
                    <span
                      key={m}
                      className="rounded bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-xs font-mono text-green-400"
                    >
                      {m}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">
                    No months trained yet. Click &quot;Train Now&quot; to start.
                  </span>
                )}
              </div>
            </div>

            {/* Ham Source */}
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
                <CheckCircle className="h-4 w-4 text-green-400" />
                Ham Corpus
              </h3>
              <div className="space-y-2 text-sm">
                <p className="text-slate-400">
                  Source:{" "}
                  <span className="text-slate-300">
                    SpamAssassin easy_ham
                  </span>
                </p>
                <p className="text-slate-400">
                  Status:{" "}
                  {status.ham_corpus_trained ? (
                    <span className="text-green-400">Trained</span>
                  ) : (
                    <span className="text-yellow-400">Not yet trained</span>
                  )}
                </p>
                <p className="text-slate-400">Schedule: One-time</p>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-white mb-3">
              How it works
            </h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">1.</span>
                Downloads monthly spam archives from untroubled.org (up to 1000 messages per month)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">2.</span>
                Downloads SpamAssassin ham corpus (one-time, ~500 messages)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">3.</span>
                Feeds messages to rspamd via learn_spam/learn_ham API
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">4.</span>
                rspamd updates its Bayes classifier with the new data
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">5.</span>
                Quarantine approve/reject actions also train the filter (and sync to federation peers)
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
