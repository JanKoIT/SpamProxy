import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET() {
  const res = await fetch(`${API_BASE}/api/dovecot/sieve-kit`);
  const blob = await res.arrayBuffer();
  return new NextResponse(blob, {
    status: res.status,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": "attachment; filename=dovecot-sieve-kit.tar.gz",
    },
  });
}
