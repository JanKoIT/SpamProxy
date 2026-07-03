import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(req: NextRequest) {
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/api/portal/me`, {
    headers: { cookie, "Content-Type": "application/json" },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
