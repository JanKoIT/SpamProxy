import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const learn_type = searchParams.get("learn_type") ?? "spam";
  const res = await fetch(`${API_BASE}/api/mail-log/${id}/learn?learn_type=${learn_type}`, { method: "POST", headers: { "Content-Type": "application/json" } });
  return NextResponse.json(await res.json(), { status: res.status });
}
