import { NextResponse } from "next/server";

const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/system-status`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json(
      {
        overall: "error",
        services: {
          "mail-service": { status: "error", detail: "mail-service unreachable" },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
