import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE } from "@/lib/auth";
import { config, proxy } from "./proxy";

const TOKEN = "test-access-token-0123456789";
const req = (path: string, init?: { method?: string; headers?: Record<string, string> }) =>
  new NextRequest(new URL(path, "http://localhost:3000"), init);

beforeEach(() => vi.stubEnv("APP_ACCESS_TOKEN", TOKEN));
afterEach(() => vi.unstubAllEnvs());

describe("proxy (접근 보호)", () => {
  it("토큰 없는 API 요청은 401 { code, message }", async () => {
    const res = proxy(req("/api/v1/trips"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "UNAUTHORIZED", message: expect.any(String) });
  });

  it("토큰 없는 페이지 요청은 /unlock?next=... 로 리다이렉트", () => {
    const res = proxy(req("/trips/abc?tab=map"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/unlock");
    expect(location.searchParams.get("next")).toBe("/trips/abc?tab=map");
  });

  it("올바른 Bearer 헤더 또는 쿠키면 통과", () => {
    const viaHeader = proxy(req("/api/v1/trips", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(viaHeader.headers.get("x-middleware-next")).toBe("1");

    const viaCookie = proxy(req("/", { headers: { cookie: `${ACCESS_COOKIE}=${TOKEN}` } }));
    expect(viaCookie.headers.get("x-middleware-next")).toBe("1");
  });

  it("틀린 토큰은 거부", () => {
    const res = proxy(req("/api/v1/trips", { headers: { authorization: "Bearer wrong" } }));
    expect(res.status).toBe(401);
  });

  it("공개 경로는 토큰 없이 통과", () => {
    expect(proxy(req("/api/healthz")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/unlock")).headers.get("x-middleware-next")).toBe("1");
  });

  it("다른 출처에서 온 상태 변경 요청은 쿠키가 맞아도 403 (CSRF)", async () => {
    const cookie = `${ACCESS_COOKIE}=${TOKEN}`;
    const post = (headers: Record<string, string>, path = "/api/v1/trips") =>
      proxy(req(path, { method: "POST", headers: { cookie, host: "localhost:3000", ...headers } }));

    const foreign = post({ origin: "http://localhost:3300" }); // 같은 사이트의 다른 포트 앱
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(post({ "sec-fetch-site": "same-site" }).status).toBe(403);
    expect(post({ origin: "null" }).status).toBe(403);
    expect(post({ origin: "https://evil.example" }, "/api/unlock").status).toBe(403); // 로그인 CSRF

    // 같은 출처·브라우저 밖 클라이언트·조회 요청은 통과
    expect(post({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }).headers.get("x-middleware-next")).toBe("1");
    expect(post({}).headers.get("x-middleware-next")).toBe("1");
    expect(post({ origin: "https://app.example", "x-forwarded-host": "app.example" }).headers.get("x-middleware-next")).toBe("1");
    const get = proxy(req("/api/v1/trips", { headers: { cookie, origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
    expect(get.headers.get("x-middleware-next")).toBe("1");
  });

  it("matcher: API는 확장자와 관계없이 항상 검사하고, 페이지의 정적 자산만 제외한다", () => {
    const runs = (url: string) => doesProxyMatch({ config, url });
    expect(runs("/api/v1/trips")).toBe(true);
    expect(runs("/api/v1/trips/abc.png")).toBe(true);
    expect(runs("/api/v1/cities/00000000-0000-0000-0000-000000000000.svg")).toBe(true);
    expect(runs("/trips")).toBe(true);
    expect(runs("/next.svg")).toBe(false);
    expect(runs("/_next/static/chunks/app.js")).toBe(false);
  });

  it("APP_ACCESS_TOKEN 미설정이면 열지 않고 500", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("APP_ACCESS_TOKEN", "");
    expect(proxy(req("/api/v1/trips", { headers: { authorization: "Bearer " } })).status).toBe(500);
  });
});
