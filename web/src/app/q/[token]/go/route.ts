import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const res = await fetch(`${API_BASE}/q/${encodeURIComponent(token)}/go`, {
      cache: "no-store",
    });
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
