import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/api/dovecot/learn-script${qs ? `?${qs}` : ""}`, {
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "Content-Type": "text/x-shellscript",
      "Content-Disposition": "attachment; filename=dovecot-learn.sh",
    },
  });
}
