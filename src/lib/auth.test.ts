import { describe, expect, it } from "vitest";
import { extractToken, isPublicPath, safeTokenEquals, sanitizeNextPath } from "./auth";

describe("safeTokenEquals", () => {
  const token = "s3cr3t-token-value-1234";

  it("같은 값만 true", () => {
    expect(safeTokenEquals(token, token)).toBe(true);
    expect(safeTokenEquals(`${token}x`, token)).toBe(false);
    expect(safeTokenEquals("S3CR3T-token-value-1234", token)).toBe(false);
  });

  it("길이가 달라도 예외 없이 false (timingSafeEqual 길이 불일치 회피)", () => {
    expect(() => safeTokenEquals("a", token)).not.toThrow();
    expect(safeTokenEquals("a", token)).toBe(false);
  });

  it("빈 값은 항상 false", () => {
    expect(safeTokenEquals("", "")).toBe(false);
    expect(safeTokenEquals("", token)).toBe(false);
    expect(safeTokenEquals(token, "")).toBe(false);
  });
});

describe("extractToken", () => {
  it("Bearer 헤더를 쿠키보다 우선한다", () => {
    expect(extractToken("Bearer abc", "cookie")).toBe("abc");
    expect(extractToken("bearer  abc ", undefined)).toBe("abc");
    expect(extractToken(null, "cookie")).toBe("cookie");
    expect(extractToken("Basic abc", "cookie")).toBe("cookie");
    expect(extractToken(null, undefined)).toBeUndefined();
  });
});

describe("isPublicPath", () => {
  it("unlock·healthz만 공개", () => {
    expect(isPublicPath("/unlock")).toBe(true);
    expect(isPublicPath("/unlock/")).toBe(true);
    expect(isPublicPath("/api/healthz")).toBe(true);
    expect(isPublicPath("/api/unlock")).toBe(true);
    expect(isPublicPath("/api/v1/trips")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/unlocked")).toBe(false);
  });
});

describe("sanitizeNextPath", () => {
  it.each([
    ["/trips/1?x=1", "/trips/1?x=1"],
    [undefined, "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/unlock?next=/", "/"],
    ["/api/v1/trips", "/"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizeNextPath(input)).toBe(expected);
  });
});
