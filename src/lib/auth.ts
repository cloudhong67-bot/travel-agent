import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "tp_access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30일

/** 인증 없이 접근 가능한 경로 */
const PUBLIC_PATHS = new Set(["/unlock", "/api/unlock", "/api/healthz"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname.replace(/\/+$/, "") || "/");
}

/**
 * 타이밍 공격에 안전한 토큰 비교.
 * 길이가 다르면 timingSafeEqual이 throw하고 길이 정보가 새므로, 양쪽을 SHA-256으로 고정 길이로 만든 뒤 비교한다.
 */
export function safeTokenEquals(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Authorization: Bearer 헤더 우선, 없으면 쿠키 값 */
export function extractToken(authorization: string | null, cookieValue: string | undefined): string | undefined {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1].trim() || cookieValue || undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF 방지: 상태를 바꾸는 요청(POST·DELETE 등)이 다른 출처의 페이지에서 왔는지.
 * Next.js는 Server Action에만 Origin 검사를 하고 Route Handler에는 하지 않으므로 직접 막는다.
 * SameSite=Lax 쿠키만으로는 같은 사이트의 다른 앱(예: localhost의 다른 포트)에서 오는 요청을 막지 못한다.
 *  - 브라우저가 보내는 Sec-Fetch-Site가 same-origin/none이 아니면 거부
 *  - Origin이 있으면 요청 호스트(x-forwarded-host → host)와 같아야 한다
 *  - Origin이 없는 요청(curl 등 브라우저 밖 클라이언트)은 여기서 막지 않는다 (토큰 검사는 별도)
 */
export function isCrossOriginWrite(method: string, headers: { get(name: string): string | null }): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = headers.get("origin");
  if (!origin) return false;
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0].trim();
  try {
    return origin === "null" || !host || new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** 오픈 리다이렉트 방지: 같은 사이트의 상대 경로만 허용 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/unlock") || next.startsWith("/api/")) return "/";
  return next;
}
