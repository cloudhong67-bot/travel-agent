import { describe, expect, it, vi } from "vitest";
import { HttpError, isRetryable, redactUrl, TimeoutError, withTimeoutRetry } from "./http";

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
});

describe("redactUrl", () => {
  it("쿼리스트링의 key를 가린다", () => {
    expect(redactUrl("https://x/api?address=a&key=SECRET")).toBe("https://x/api?address=a&key=***");
  });
});
