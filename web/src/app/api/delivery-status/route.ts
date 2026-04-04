import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const res = await fetch(`${API_BASE}/api/delivery-status${qs ? `?${qs}` : ""}`, {
    headers: { "Content-Type": "application/json" },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
