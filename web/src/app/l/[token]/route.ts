import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

/**
 * Safe Links click endpoint. Proxies to the mail-service which verifies the
 * signed token, checks the destination's reputation, and returns either an
 * interstitial/block HTML page (200) or a redirect to the external target.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const res = await fetch(`${API_BASE}/l/${encodeURIComponent(token)}`, {
      redirect: "manual",
      cache: "no-store",
    });

    // The mail-service returns an absolute external URL in Location, so it is
    // safe to forward the redirect directly to the browser.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location) {
        return NextResponse.redirect(location, 302);
      }
    }

    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch {
    return new NextResponse(
      `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:80px;">
       <h1 style="color:#dc2626;">Service nicht erreichbar</h1>
       <p>Bitte versuchen Sie es später erneut.</p></body></html>`,
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
