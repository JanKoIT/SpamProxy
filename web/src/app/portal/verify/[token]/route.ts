import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  // Follow: false so we can read the Set-Cookie and preserve it.
  const res = await fetch(`${API_BASE}/portal/verify/${encodeURIComponent(token)}`, {
    redirect: "manual",
    cache: "no-store",
  });

  const setCookie = res.headers.get("set-cookie");
  // On success (303 redirect) forward user to /portal/quarantine; on failure show error HTML
  if (res.status === 303 || res.status === 302) {
    const out = NextResponse.redirect(new URL("/portal/quarantine", _req.url), 303);
    if (setCookie) {
      out.headers.set("set-cookie", setCookie);
    }
    return out;
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
