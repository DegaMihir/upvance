import { NextResponse, type NextRequest } from "next/server";

/**
 * Passes the page path to the app layout (as the "x-pathname" request header), so the layout
 * can send you to /setup until first-time setup is done, while still allowing /profile.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icons|brand|manifest.webmanifest|sw.js|offline.html|.*\\.(?:png|svg|jpg|ico|js|css|pdf)$).*)"],
};
