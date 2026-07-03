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
  // On success (303 redirect) forward user to /portal/quarantine. We use a
  // relative Location header (not new URL(..., req.url)) - inside Docker,
  // req.url is the container URL like http://3ac...:3000, which would
  // redirect the browser to that unreachable host. A relative Location is
  // resolved by the browser against the user-facing origin.
  if (res.status === 303 || res.status === 302) {
    const headers = new Headers({ Location: "/portal/quarantine" });
    if (setCookie) {
      headers.set("set-cookie", setCookie);
    }
    return new NextResponse(null, { status: 303, headers });
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
