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

/** 오픈 리다이렉트 방지: 같은 사이트의 상대 경로만 허용 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/unlock") || next.startsWith("/api/")) return "/";
  return next;
}
