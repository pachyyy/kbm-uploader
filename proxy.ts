import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyAuthToken } from "@/lib/auth";

// Gates the whole app behind a shared secret. Without this, anyone who
// finds the public Vercel URL could submit to SIDIA using this app's
// stored credentials. Uses an in-app login page + signed cookie rather
// than browser Basic Auth, since the Basic Auth popup made it easy to
// mistake this app's password for the separate SIDIA login.
export function proxy(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    // Fail closed rather than silently running with no gate.
    return new NextResponse("APP_PASSWORD is not configured.", { status: 500 });
  }

  if (req.nextUrl.pathname === "/login" || req.nextUrl.pathname === "/api/auth") {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (verifyAuthToken(token)) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
