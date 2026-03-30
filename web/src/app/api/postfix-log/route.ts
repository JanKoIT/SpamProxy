import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lines = searchParams.get("lines") ?? "200";
  const search = searchParams.get("search") ?? "";

  const res = await fetch(
    `${API_BASE}/api/postfix-log?lines=${lines}&search=${encodeURIComponent(search)}`,
    { headers: { "Content-Type": "application/json" } }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
