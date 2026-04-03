import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET() {
  const res = await fetch(`${API_BASE}/api/keyword-rules/export`, {
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  // Set count correctly
  data.count = data.rules?.length ?? 0;
  return NextResponse.json(data, { status: res.status });
}
