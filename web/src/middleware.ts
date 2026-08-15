import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// API paths that must NOT be subject to admin-app RBAC: authentication,
// the end-user quarantine portal (own cookie auth), and demo data.
const API_RBAC_EXEMPT = ["/api/auth", "/api/portal", "/api/demo"];
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Skip auth in demo mode (cookie or query param)
  const isDemo =
    request.nextUrl.searchParams.has("demo") ||
    request.cookies.get("spamproxy_demo")?.value === "true";

  if (isDemo) {
    // Set demo cookie so it persists across pages
    const response = NextResponse.next();
    response.cookies.set("spamproxy_demo", "true", { path: "/" });
    return response;
  }

  const token = await getToken({ req: request });

  // --- API routes: enforce RBAC, but never redirect an API call to /login ---
  if (path.startsWith("/api/")) {
    const exempt = API_RBAC_EXEMPT.some((p) => path.startsWith(p));
    const mutating = !SAFE_METHODS.includes(request.method);
    // Viewers (and any non-admin) are read-only: block mutating admin API calls.
    if (!exempt && mutating && token && token.role !== "admin") {
      return NextResponse.json({ error: "Forbidden (read-only role)" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // --- Page routes: must be logged in ---
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // User management is admin-only.
  if (path.startsWith("/settings/users") && token.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/quarantine/:path*",
    "/recipients/:path*",
    "/logs/:path*",
    "/queue/:path*",
    "/scan-history/:path*",
    "/settings/:path*",
    "/users/:path*",
    "/api/:path*",
  ],
};
