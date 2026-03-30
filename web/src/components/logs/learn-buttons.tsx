"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";

export function LearnButtons({ logId }: { logId: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function learn(type: "spam" | "ham") {
    setLoading(type);
    try {
      await fetch(`/api/mail-log/${logId}/learn?learn_type=${type}`, { method: "POST" });
      setDone(type);
    } finally {
      setLoading(null);
    }
  }

  if (done) {
    return (
      <span className={`text-xs ${done === "spam" ? "text-red-400" : "text-green-400"}`}>
        {done === "spam" ? "Als Spam gelernt" : "Als Ham gelernt"}
      </span>
    );
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={() => learn("spam")}
        disabled={loading !== null}
        title="Als Spam lernen"
        className="rounded p-1 text-red-400/60 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50 transition-colors"
      >
        {loading === "spam" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={() => learn("ham")}
        disabled={loading !== null}
        title="Als Ham (kein Spam) lernen"
        className="rounded p-1 text-green-400/60 hover:bg-green-900/30 hover:text-green-400 disabled:opacity-50 transition-colors"
      >
        {loading === "ham" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
