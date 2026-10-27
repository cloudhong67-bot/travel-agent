import { describe, expect, it } from "vitest";
import type { PlannedStop } from "./types";
import { issuesToFeedback, validateDay } from "./validator";

const stop = (patch: Partial<PlannedStop> = {}): PlannedStop => ({
  order: 1,
  key: "P01",
  poiId: "x",
  name: "볼사 궁전",
  category: "sight",
  lat: 41.14,
  lon: -8.61,
  arrive: "09:10",
  depart: "10:10",
  stayMins: 60,
  travelMinsFromPrev: 10,
  sourceUrl: "https://maps.google.com/?cid=1",
  openingHours: ["월요일: 휴무일", "화요일: 오전 9:00~오후 6:00"],
  ...patch,
});
const day = (stops: PlannedStop[], travelMins = 20, weekday: number | null = 2, dayTripTown: string | null = null) => {
  const stayMins = stops.reduce((s, x) => s + x.stayMins, 0);
  return { stops, weekday, dayTripTown, totals: { travelMins, stayMins, travelRatio: stayMins ? travelMins / stayMins : 0 } };
};
const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

describe("validateDay", () => {
  it("문제가 없으면 빈 배열", () => {
    expect(validateDay(day([stop()]))).toEqual([]);
  });

  it("closedDay: 휴무 요일 배치 (출발일 미정이면 검사 안 함)", () => {
    expect(rules(validateDay(day([stop()], 20, 1)))).toEqual(["closedDay"]);
    expect(validateDay(day([stop()], 20, 1))[0].message).toContain("월요일 휴무");
    expect(validateDay(day([stop()], 20, null))).toEqual([]);
    expect(validateDay(day([stop({ openingHours: null })], 20, 1))).toEqual([]); // 정보 없음 ≠ 휴무
    expect(rules(validateDay(day([stop({ openingHours: ["Monday: Closed"] })], 20, 1)))).toEqual(["closedDay"]);
  });

  it("travelRatio: 이동/체류 > 40%만 실패, 근교 당일치기 일자는 제외", () => {
    expect(validateDay(day([stop()], 24))).toEqual([]); // 40%
    expect(rules(validateDay(day([stop()], 25)))).toEqual(["travelRatio"]); // 41.7%
    expect(validateDay(day([stop({ category: "town", openingHours: null })], 200, 2, "브라가"))).toEqual([]);
  });

  it("missingCoords / missingSource", () => {
    expect(rules(validateDay(day([stop({ lat: Number.NaN })])))).toEqual(["missingCoords"]);
    expect(rules(validateDay(day([stop({ sourceUrl: null })])))).toEqual(["missingSource"]);
  });

  it("재시도 피드백 문장", () => {
    const fb = issuesToFeedback(validateDay(day([stop({ sourceUrl: null })], 100, 1)));
    expect(fb).toContain("P01: 이 날은 휴무");
    expect(fb).toContain("이동시간 비율 초과");
    expect(fb).toContain("출처 링크 없음");
  });
});
