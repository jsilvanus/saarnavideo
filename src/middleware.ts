import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_HEADER, accessSecret, isAuthorized, isPublicPath } from "@/lib/access-gate";

export const PATH_HEADER = "x-saarnavideo-path";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // The layout reads the path to leave its navigation off the login page.
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, pathname);
  const pass = () => NextResponse.next({ request: { headers } });

  const secret = accessSecret();
  if (!secret || isPublicPath(pathname)) return pass();

  const allowed = await isAuthorized({
    secret,
    cookie: request.cookies.get(GATE_COOKIE)?.value,
    header: request.headers.get(GATE_HEADER),
    authorization: request.headers.get("authorization"),
  });
  if (allowed) return pass();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
