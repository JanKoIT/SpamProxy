import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rule_type = searchParams.get("rule_type") ?? "";
  const qs = rule_type ? `?rule_type=${rule_type}` : "";
  const res = await fetch(`${API_BASE}/api/scoring-rules${qs}`, { headers: { "Content-Type": "application/json" } });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${API_BASE}/api/scoring-rules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return NextResponse.json(await res.json(), { status: res.status });
}
