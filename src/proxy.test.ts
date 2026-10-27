import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE } from "@/lib/auth";
import { proxy } from "./proxy";

const TOKEN = "test-access-token-0123456789";
const req = (path: string, init?: { headers?: Record<string, string> }) =>
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

  it("APP_ACCESS_TOKEN 미설정이면 열지 않고 500", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("APP_ACCESS_TOKEN", "");
    expect(proxy(req("/api/v1/trips", { headers: { authorization: "Bearer " } })).status).toBe(500);
  });
});
