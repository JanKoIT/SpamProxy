import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const list_type = searchParams.get("list_type") ?? "";
  const qs = list_type ? `?list_type=${list_type}` : "";
  const res = await fetch(`${API_BASE}/api/access-lists${qs}`, { headers: { "Content-Type": "application/json" } });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${API_BASE}/api/access-lists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return NextResponse.json(await res.json(), { status: res.status });
}
