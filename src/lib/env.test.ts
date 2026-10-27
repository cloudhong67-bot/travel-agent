import { describe, expect, it } from "vitest";
import { pickEnv } from "./env";

describe("pickEnv", () => {
  it("요청한 키만 검증하고 기본값을 적용한다", () => {
    expect(pickEnv(["DAILY_TRIP_LIMIT"], {})).toEqual({ DAILY_TRIP_LIMIT: 10 });
    expect(pickEnv(["DAILY_TRIP_LIMIT"], { DAILY_TRIP_LIMIT: "3", GEMINI_API_KEY: "" })).toEqual({
      DAILY_TRIP_LIMIT: 3,
    });
  });

  it("누락·형식 오류는 키 이름과 함께 throw", () => {
    expect(() => pickEnv(["APP_ACCESS_TOKEN"], {})).toThrow(/APP_ACCESS_TOKEN/);
    expect(() => pickEnv(["APP_ACCESS_TOKEN"], { APP_ACCESS_TOKEN: "short" })).toThrow(/16자/);
    expect(() => pickEnv(["DAILY_TRIP_LIMIT"], { DAILY_TRIP_LIMIT: "0" })).toThrow(/DAILY_TRIP_LIMIT/);
  });
});
