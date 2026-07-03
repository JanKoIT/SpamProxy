import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(req: NextRequest) {
  const cookie = req.headers.get("cookie") ?? "";
  const qs = req.nextUrl.searchParams.toString();
  const res = await fetch(`${API_BASE}/api/portal/quarantine?${qs}`, {
    headers: { cookie },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
