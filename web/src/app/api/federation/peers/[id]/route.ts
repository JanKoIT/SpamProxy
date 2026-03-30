import { NextRequest, NextResponse } from "next/server";
const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  if (body.toggle) {
    const res = await fetch(`${API_BASE}/api/federation/peers/${id}/toggle`, { method: "PUT", headers: { "Content-Type": "application/json" } });
    return NextResponse.json(await res.json(), { status: res.status });
  }
  const res = await fetch(`${API_BASE}/api/federation/peers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return NextResponse.json(await res.json(), { status: res.status });
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API_BASE}/api/federation/peers/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
  return NextResponse.json(await res.json(), { status: res.status });
}
