import { describe, expect, it } from "vitest";
import { isDailyLimitExceeded, seoulDateKey, toDbDate } from "./limits";

describe("seoulDateKey", () => {
  it("UTC 15:00 이후는 서울 기준 다음 날", () => {
    expect(seoulDateKey(new Date("2026-10-27T14:59:59Z"))).toBe("2026-10-27");
    expect(seoulDateKey(new Date("2026-10-27T15:00:00Z"))).toBe("2026-10-28");
  });

  it("DATE 컬럼용 UTC 자정으로 변환", () => {
    expect(toDbDate("2026-10-28").toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });
});

describe("isDailyLimitExceeded", () => {
  it("사용량이 한도 이상이면 초과", () => {
    expect(isDailyLimitExceeded(0, 10)).toBe(false);
    expect(isDailyLimitExceeded(9, 10)).toBe(false);
    expect(isDailyLimitExceeded(10, 10)).toBe(true);
    expect(isDailyLimitExceeded(11, 10)).toBe(true);
  });
});
