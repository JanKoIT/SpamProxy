import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await fetch(`${API_BASE}/api/recipients/${id}/send-now`, { method: "POST" });
  return NextResponse.json(await res.json(), { status: res.status });
}
