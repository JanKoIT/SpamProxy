import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${API_BASE}/api/sender-domains/${id}/check-dns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
