import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/api/portal/access-list/${id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
