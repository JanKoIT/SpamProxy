export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/quarantine/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/users/:path*",
  ],
};
