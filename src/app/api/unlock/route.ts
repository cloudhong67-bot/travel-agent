import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, safeTokenEquals, sanitizeNextPath } from "@/lib/auth";
import { pickEnv } from "@/lib/env";
import { UnlockFormSchema } from "@/lib/schemas";

/** 무차별 대입을 늦추기 위한 실패 지연 */
const FAILURE_DELAY_MS = 500;

/**
 * POST /api/unlock — /unlock 화면의 폼 제출. 토큰이 맞으면 httpOnly 쿠키를 설정하고 next로 303 리다이렉트.
 * JS 없이 동작하도록 일반 form POST(application/x-www-form-urlencoded)를 받는다.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const parsed = UnlockFormSchema.safeParse({
    token: form?.get("token") ?? "",
    next: form?.get("next") ?? undefined,
  });
  const next = sanitizeNextPath(parsed.success ? parsed.data.next : undefined);

  const { APP_ACCESS_TOKEN } = pickEnv(["APP_ACCESS_TOKEN"]);
  if (!parsed.success || !safeTokenEquals(parsed.data.token, APP_ACCESS_TOKEN)) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    const back = new URL("/unlock", url);
    back.searchParams.set("error", "1");
    if (next !== "/") back.searchParams.set("next", next);
    return Response.redirect(back, 303);
  }

  const cookie = [
    `${ACCESS_COOKIE}=${encodeURIComponent(parsed.data.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
    ...(url.protocol === "https:" ? ["Secure"] : []),
  ].join("; ");

  return new Response(null, {
    status: 303,
    headers: { Location: new URL(next, url).toString(), "Set-Cookie": cookie },
  });
}
