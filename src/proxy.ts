import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, extractToken, isCrossOriginWrite, isPublicPath, safeTokenEquals } from "@/lib/auth";
import { pickEnv } from "@/lib/env";
import { apiError } from "@/server/api/respond";

/**
 * 접근 보호 (Next.js 16에서 middleware.ts → proxy.ts로 이름이 바뀜, Node.js 런타임).
 * 로그인 없이 APP_ACCESS_TOKEN과 일치하는 httpOnly 쿠키 또는 Authorization: Bearer 헤더만 통과시킨다.
 *   - /api/**  → 401 { code, message }
 *   - 페이지   → /unlock?next=<원래 경로>
 * 다른 출처에서 온 상태 변경 요청(CSRF)은 공개 경로(/api/unlock 포함)라도 403으로 막는다.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isCrossOriginWrite(request.method, request.headers)) {
    return apiError(403, "FORBIDDEN", "다른 사이트에서 보낸 요청은 허용하지 않습니다.");
  }
  if (isPublicPath(pathname)) return NextResponse.next();

  const expected = readAccessToken();
  // 토큰 미설정 시 열어두지 않고 막는다 (fail closed)
  if (!expected) return apiError(500, "SERVER_MISCONFIGURED", "서버 접근 토큰이 설정되지 않았습니다.");

  const provided = extractToken(request.headers.get("authorization"), request.cookies.get(ACCESS_COOKIE)?.value);
  if (provided && safeTokenEquals(provided, expected)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return apiError(401, "UNAUTHORIZED", "접근 토큰이 없거나 올바르지 않습니다.", { "WWW-Authenticate": "Bearer" });
  }
  const unlock = new URL("/unlock", request.url);
  unlock.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(unlock);
}

function readAccessToken(): string | null {
  try {
    return pickEnv(["APP_ACCESS_TOKEN"]).APP_ACCESS_TOKEN;
  } catch (error) {
    console.error("[proxy] APP_ACCESS_TOKEN misconfigured", error);
    return null;
  }
}

export const config = {
  matcher: [
    // API는 경로 모양과 관계없이 항상 검사한다. 아래 확장자 제외만 있으면 /api/v1/trips/x.png 같은 경로가
    // 토큰 검사 없이 라우트까지 간다
    "/api/:path*",
    // 페이지: 정적 자산은 제외 (막으면 /unlock 화면의 CSS·JS·이미지도 막힌다)
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
