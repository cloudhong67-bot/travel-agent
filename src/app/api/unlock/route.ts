import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, safeTokenEquals, sanitizeNextPath } from "@/lib/auth";
import { pickEnv } from "@/lib/env";
import { UnlockFormSchema } from "@/lib/schemas";

/** 무차별 대입을 늦추기 위한 실패 지연 */
const FAILURE_DELAY_MS = 500;

/**
 * POST /api/unlock — /unlock 화면의 폼 제출. 토큰이 맞으면 httpOnly 쿠키를 설정하고 next로 303 리다이렉트.
 * JS 없이 동작하도록 일반 form POST(application/x-www-form-urlencoded)를 받는다.
 *
 * Location은 상대 경로로 보낸다. standalone 서버의 request.url은 브라우저가 접속한 주소가 아니라
 * 서버 바인딩 주소(예: http://0.0.0.0:3000)라서, 이것으로 절대 URL을 만들면 프록시·포트 매핑 뒤에서 깨진다.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const parsed = UnlockFormSchema.safeParse({
    token: form?.get("token") ?? "",
    next: form?.get("next") ?? undefined,
  });
  // 토큰 형식이 틀려도 원래 가려던 경로는 유지한다
  const nextParsed = UnlockFormSchema.shape.next.safeParse(form?.get("next") ?? undefined);
  const next = sanitizeNextPath(nextParsed.success ? nextParsed.data : undefined);

  const { APP_ACCESS_TOKEN } = pickEnv(["APP_ACCESS_TOKEN"]);
  if (!parsed.success || !safeTokenEquals(parsed.data.token, APP_ACCESS_TOKEN)) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    const query = new URLSearchParams({ error: "1" });
    if (next !== "/") query.set("next", next);
    return new Response(null, { status: 303, headers: { Location: `/unlock?${query}` } });
  }

  // 프로토콜은 x-forwarded-proto를 반영한다 (ACA는 TLS를 앞단에서 종료하고 https로 전달)
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `${ACCESS_COOKIE}=${encodeURIComponent(parsed.data.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");

  return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie } });
}
