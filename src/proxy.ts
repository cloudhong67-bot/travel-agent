import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, extractToken, isPublicPath, safeTokenEquals } from "@/lib/auth";
import { pickEnv } from "@/lib/env";

/**
 * 접근 보호 (Next.js 16에서 middleware.ts → proxy.ts로 이름이 바뀜, Node.js 런타임).
 * 로그인 없이 APP_ACCESS_TOKEN과 일치하는 httpOnly 쿠키 또는 Authorization: Bearer 헤더만 통과시킨다.
 *   - /api/**  → 401 { code, message }
 *   - 페이지   → /unlock?next=<원래 경로>
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");

  let expected: string;
  try {
    expected = pickEnv(["APP_ACCESS_TOKEN"]).APP_ACCESS_TOKEN;
  } catch (error) {
    // 토큰 미설정 시 열어두지 않고 막는다 (fail closed)
    console.error("[proxy] APP_ACCESS_TOKEN misconfigured", error);
    return NextResponse.json(
      { code: "SERVER_MISCONFIGURED", message: "서버 접근 토큰이 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  const provided = extractToken(request.headers.get("authorization"), request.cookies.get(ACCESS_COOKIE)?.value);
  if (provided && safeTokenEquals(provided, expected)) return NextResponse.next();

  if (isApi) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "접근 토큰이 없거나 올바르지 않습니다." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const unlock = new URL("/unlock", request.url);
  unlock.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(unlock);
}

export const config = {
  // 정적 자산은 제외 (막으면 /unlock 화면의 CSS·JS도 막힌다)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
