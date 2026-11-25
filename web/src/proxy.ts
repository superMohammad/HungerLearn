import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANGUAGE, isLanguage, LANG_COOKIE } from "@/lib/i18n";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Language routing with clean URLs. `/en/...` and `/ar/...` set the language cookie and redirect to
 * the unprefixed path; every other page request is rewritten to `/<cookie language>/...`.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const [, first, ...rest] = pathname.split("/");
  if (isLanguage(first)) {
    const response = NextResponse.redirect(new URL(`/${rest.join("/")}${search}`, request.url));
    response.cookies.set(LANG_COOKIE, first, { path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax" });
    return response;
  }
  const cookie = request.cookies.get(LANG_COOKIE)?.value ?? DEFAULT_LANGUAGE;
  const lang = isLanguage(cookie) ? cookie : DEFAULT_LANGUAGE;
  return NextResponse.rewrite(new URL(`/${lang}${pathname}${search}`, request.url));
}

export const config = {
  // Pages only: not the media API, Next internals, or files with an extension (images, favicon).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
