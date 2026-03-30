import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API_BASE}/api/dkim/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API_BASE}/api/dkim/${id}/toggle`, { method: "PUT", headers: { "Content-Type": "application/json" } });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
