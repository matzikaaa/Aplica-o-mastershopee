import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Route protection (§7): every dashboard/onboarding/admin page requires a
 * signed-in session; /admin additionally requires isSuperAdmin, checked
 * here from the JWT so an unauthorized user never even reaches the admin
 * layout's own server-side check (defense in depth — §51).
 */
export default withAuth(
  function middleware() {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        if (!token) return false;
        if (req.nextUrl.pathname.startsWith("/admin")) {
          return Boolean((token as { isSuperAdmin?: boolean }).isSuperAdmin);
        }
        return true;
      },
    },
    pages: { signIn: "/login" },
  },
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/products/:path*",
    "/costs/:path*",
    "/orders/:path*",
    "/ads/:path*",
    "/financial/:path*",
    "/reports/:path*",
    "/alerts/:path*",
    "/integrations/:path*",
    "/settings/:path*",
    "/subscription/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
  ],
};
