import { describe, expect, it, vi } from "vitest";
import { HttpError, isQuotaExhausted, isRetryable, redactUrl, TimeoutError, withTimeoutRetry } from "./http";

describe("withTimeoutRetry", () => {
  it("일시적 실패는 1회 재시도한다", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new HttpError(503, "u", "")).mockResolvedValueOnce("ok");
    await expect(withTimeoutRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("4xx는 재시도하지 않는다", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(400, "u", "bad"));
    await expect(withTimeoutRetry(fn)).rejects.toBeInstanceOf(HttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("타임아웃되면 재시도 후 TimeoutError로 실패한다", async () => {
    const fn = vi.fn(() => new Promise<never>(() => {}));
    await expect(withTimeoutRetry(fn, { timeoutMs: 20 })).rejects.toBeInstanceOf(TimeoutError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("응답 형식 오류(JSON·스키마)는 다시 보내도 같으므로 재시도하지 않는다", async () => {
    const fn = vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <"));
    await expect(withTimeoutRetry(fn)).rejects.toBeInstanceOf(SyntaxError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryable", () => {
  it("네트워크·시간 초과·408/429/5xx만 재시도", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new TimeoutError(10))).toBe(true);
    expect(isRetryable(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isRetryable({ status: 429 })).toBe(true); // Gemini SDK ApiError
    expect(isRetryable(new HttpError(500, "u", ""))).toBe(true);
    expect(isRetryable(new HttpError(404, "u", ""))).toBe(false);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable(new Error("Invalid input"))).toBe(false);
  });

  it("하루 할당량 소진(429 RESOURCE_EXHAUSTED)은 몇 시간 뒤에야 풀리므로 재시도하지 않는다", () => {
    const daily = Object.assign(new Error('{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests ... GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}'), { status: 429 });
    const billing = Object.assign(new Error("You exceeded your current quota, please check your plan and billing details."), { status: 429 });
    expect(isQuotaExhausted(daily)).toBe(true);
    expect(isQuotaExhausted(billing)).toBe(true);
    expect(isRetryable(daily)).toBe(false);
    // 잠깐의 속도 제한(분당)은 재시도
    const burst = Object.assign(new Error("Resource has been exhausted (e.g. check quota). Requests per minute"), { status: 429 });
    expect(isQuotaExhausted(burst)).toBe(false);
    expect(isRetryable(burst)).toBe(true);
  });
});

describe("redactUrl", () => {
  it("쿼리스트링의 key를 가린다", () => {
    expect(redactUrl("https://x/api?address=a&key=SECRET")).toBe("https://x/api?address=a&key=***");
  });
});
