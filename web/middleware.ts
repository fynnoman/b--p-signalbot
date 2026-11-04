import { NextResponse, type NextRequest } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth/server";

const protect = auth.middleware({ loginUrl: "/auth/sign-in" });

export default async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const isAuthApi = url.pathname.startsWith("/api/auth");
  const isAuthPage = url.pathname.startsWith("/auth/");

  // Session nach Allowlist prüfen (Defense-in-Depth).
  // Nur auf geschützten Pfaden, damit die Sign-In-Seite selbst immer lädt.
  if (!isAuthApi && !isAuthPage) {
    try {
      const { data: session } = await auth.getSession();
      const email = session?.user?.email;
      if (email && !isAllowedEmail(email)) {
        const signInUrl = new URL("/auth/sign-in", request.url);
        signInUrl.searchParams.set("reason", "domain");
        await auth.signOut();
        return NextResponse.redirect(signInUrl);
      }
    } catch {
      // Session-Lookup darf den Request nicht crashen.
    }
  }

  return protect(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
