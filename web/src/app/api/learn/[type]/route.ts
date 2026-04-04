import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  const body = await request.arrayBuffer();
  const res = await fetch(`${API_BASE}/api/learn/${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
