import { describe, expect, it } from "vitest";
import {
  CreateTripRequestSchema,
  DayParamsSchema,
  ListTripsQuerySchema,
  ProgressEventSchema,
  TripSummarySchema,
} from "./schemas";

const valid = { city: " 포르투 ", countryCode: "pt", days: 5, startDate: "2027-05-01", style: "역사,미식", transport: "transit" };

describe("CreateTripRequestSchema", () => {
  it("정상 입력을 정규화한다 (공백 제거, 국가코드 대문자)", () => {
    const result = CreateTripRequestSchema.parse(valid);
    expect(result).toEqual({ ...valid, city: "포르투", countryCode: "PT" });
  });

  it("선택 필드 없이도 통과한다", () => {
    const rest = { city: valid.city, days: valid.days, style: valid.style, transport: valid.transport };
    expect(CreateTripRequestSchema.safeParse(rest).success).toBe(true);
  });

  it.each([
    ["빈 도시명", { city: "   " }],
    ["일수 0", { days: 0 }],
    ["일수 15", { days: 15 }],
    ["소수 일수", { days: 2.5 }],
    ["잘못된 국가코드", { countryCode: "PRT" }],
    ["잘못된 날짜", { startDate: "2027-13-40" }],
    ["알 수 없는 이동수단", { transport: "plane" }],
    ["정의되지 않은 필드", { hotel: "x" }],
    ["알 수 없는 예산 수준", { budget: "luxury" }],
  ])("%s → 거부", (_label, patch) => {
    expect(CreateTripRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("쿼리·경로 파라미터", () => {
  it("목록 limit 기본값 20, 범위 1~50", () => {
    expect(ListTripsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ListTripsQuerySchema.parse({ limit: "5" }).limit).toBe(5);
    expect(ListTripsQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(ListTripsQuerySchema.safeParse({ cursor: "abc" }).success).toBe(false);
  });

  it("dayIndex는 문자열을 정수로 변환한다", () => {
    const id = "6f1d3c2a-8a51-4c7e-9d7e-2b8f3a9c1e10";
    expect(DayParamsSchema.parse({ id, dayIndex: "2" })).toEqual({ id, dayIndex: 2 });
    expect(DayParamsSchema.safeParse({ id, dayIndex: "-1" }).success).toBe(false);
  });
});

describe("응답 스키마", () => {
  it("날짜는 ISO 8601만 허용한다", () => {
    const base = {
      id: "6f1d3c2a-8a51-4c7e-9d7e-2b8f3a9c1e10",
      cityName: "포르투",
      countryCode: null,
      cityId: null,
      days: 3,
      startDate: null,
      style: "역사",
      transport: "transit",
      budget: null,
      status: "queued",
      progress: 0,
    };
    expect(TripSummarySchema.safeParse({ ...base, createdAt: new Date().toISOString() }).success).toBe(true);
    expect(TripSummarySchema.safeParse({ ...base, createdAt: "2026/10/27" }).success).toBe(false);
  });

  it("progress는 0~100", () => {
    const e = { tripId: "6f1d3c2a-8a51-4c7e-9d7e-2b8f3a9c1e10", status: "running", step: "collect", message: "조사 중", errorMessage: null };
    expect(ProgressEventSchema.safeParse({ ...e, progress: 100 }).success).toBe(true);
    expect(ProgressEventSchema.safeParse({ ...e, progress: 101 }).success).toBe(false);
  });
});
