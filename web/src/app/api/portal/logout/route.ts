import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function POST(req: NextRequest) {
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/api/portal/logout`, {
    method: "POST",
    headers: { cookie },
  });
  const out = NextResponse.json(await res.json(), { status: res.status });
  out.cookies.delete("spamproxy_portal");
  return out;
}
