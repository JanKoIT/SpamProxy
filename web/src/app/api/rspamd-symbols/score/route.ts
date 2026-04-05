import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${API_BASE}/api/rspamd-symbols/score`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
