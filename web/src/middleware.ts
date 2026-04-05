import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
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

  // Normal auth check
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/quarantine/:path*",
    "/logs/:path*",
    "/queue/:path*",
    "/settings/:path*",
    "/users/:path*",
  ],
};
