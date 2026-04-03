import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function POST() {
  const res = await fetch(`${API_BASE}/api/bayes-training/train-now`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
