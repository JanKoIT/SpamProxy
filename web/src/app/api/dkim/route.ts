import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET() {
  const res = await fetch(`${API_BASE}/api/dkim`, { headers: { "Content-Type": "application/json" } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
