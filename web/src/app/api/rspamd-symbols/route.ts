import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET() {
  const res = await fetch(`${API_BASE}/api/rspamd-symbols`, {
    headers: { "Content-Type": "application/json" },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
