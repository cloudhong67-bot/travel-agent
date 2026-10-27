import { describe, expect, it, vi } from "vitest";
import { HttpError, redactUrl, withTimeoutRetry } from "./http";

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

  it("타임아웃되면 재시도 후 실패한다", async () => {
    const fn = vi.fn(() => new Promise<never>(() => {}));
    await expect(withTimeoutRetry(fn, { timeoutMs: 20 })).rejects.toThrow(/timeout/);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("redactUrl", () => {
  it("쿼리스트링의 key를 가린다", () => {
    expect(redactUrl("https://x/api?address=a&key=SECRET")).toBe("https://x/api?address=a&key=***");
  });
});
