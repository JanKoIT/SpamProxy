export { default } from "next-auth/middleware";

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
