import { describe, expect, it } from "vitest";
import { enforceAssignment, FALLBACK_STOPS_PER_DAY, fallbackAssignment } from "./assign";
import { Budget, BudgetExceededError, estimateMatrixCalls, estimateRouteCalls } from "./budget";
import { parseTourismAnswer } from "./prompts/tourism";
import { toGeminiSchema } from "./prompts/common";
import { AssignmentSchema } from "./prompts/assignment";
import type { AgentPoi, NearbyTown } from "./types";

const poi = (key: string): AgentPoi => ({ key, name: key, category: "sight", lat: 1, lon: 1, hours: null, sourceUrl: "https://x", origin: "google" });
const town = (name: string, kind: NearbyTown["kind"]): NearbyTown => ({ name, lat: 2, lon: 2, travelMins: 60, kind, reason: "" });

describe("enforceAssignment (주어진 POI 키만 사용)", () => {
  const opts = { dayIndexes: [0, 1], pois: [poi("P01"), poi("P02"), poi("P03")], nearbyTowns: [town("브라가", "dayTrip"), town("리스본", "overnight")], allowDayTrip: true };

  it("목록에 없는 키·중복·요청 외 일자를 버리고 경고를 남긴다", () => {
    const { days, warnings } = enforceAssignment(
      {
        days: [
          { dayIndex: 0, title: "a", dayTripTown: null, stops: [{ poiKey: "P01", stayMins: 60 }, { poiKey: "P99", stayMins: 60 }, { poiKey: "P01", stayMins: 30 }] },
          { dayIndex: 5, title: "x", dayTripTown: null, stops: [{ poiKey: "P02", stayMins: 60 }] },
        ],
      },
      opts,
    );
    expect(days.get(0)?.stops.map((s) => s.poi.key)).toEqual(["P01"]);
    expect(days.get(1)).toMatchObject({ title: "자유 일정", stops: [] }); // 누락 일자
    expect(warnings.join("\n")).toMatch(/P99[\s\S]*중복[\s\S]*6일차[\s\S]*2일차/);
  });

  it("근교 도시는 당일치기 목록에 있는 것만, 3일 미만이면 무시", () => {
    const a = { days: [{ dayIndex: 0, title: "t", dayTripTown: "브라가", stops: [{ poiKey: "P01", stayMins: 60 }] }, { dayIndex: 1, title: "t", dayTripTown: "리스본", stops: [] }] };
    const r = enforceAssignment(a, opts);
    expect(r.days.get(0)).toMatchObject({ dayTripTown: "브라가", stops: [] });
    expect(r.days.get(1)?.dayTripTown).toBeNull(); // 1박 추천 도시는 당일치기 배정 불가
    expect(enforceAssignment(a, { ...opts, allowDayTrip: false }).days.get(0)?.dayTripTown).toBeNull();
  });

  it("함수 선언용 JSON Schema에 $schema 키가 없다", () => {
    const schema = toGeminiSchema(AssignmentSchema);
    expect(schema.$schema).toBeUndefined();
    expect(schema).toMatchObject({ type: "object", properties: { days: { type: "array" } } });
  });
});

describe("parseTourismAnswer", () => {
  it("머리표 형식을 해석하고 '정보 없음'은 비운다", () => {
    const parsed = parseTourismAnswer(
      ["**요약:** 항구 도시.", "공식사이트: https://www.visitporto.travel 입니다", "추천명소: A; B ; C", "축제: 정보 없음", "교통패스: Andante — 가격 정보 없음"].join("\n"),
    );
    expect(parsed).toEqual({
      summary: "항구 도시.",
      officialSite: "https://www.visitporto.travel",
      recommended: ["A", "B", "C"],
      festivals: [],
      transitPasses: ["Andante — 가격 정보 없음"],
    });
  });

  it("형식이 어긋나면 원문 전체를 요약으로", () => {
    expect(parseTourismAnswer("그냥 문장")).toMatchObject({ summary: "그냥 문장", recommended: [] });
  });
});

describe("Budget (요청당 비용 가드)", () => {
  it("상한을 넘기기 전에 막는다", () => {
    const b = new Budget({ maxGeminiCalls: 2, maxMapsCalls: 10 });
    b.reserveGemini();
    b.reserveGemini();
    expect(() => b.reserveGemini()).toThrow(BudgetExceededError);
    b.reserveMaps(10);
    expect(() => b.reserveMaps(1)).toThrow(/지도 API 호출 상한\(10회\)/);
  });

  it("공급자별로 합쳐 기록하고 사고 토큰은 출력에 포함한다", () => {
    const b = new Budget({ maxGeminiCalls: 15, maxMapsCalls: 200 });
    b.recordLlm("gemini", { inputTokens: 100, outputTokens: 10, thoughtTokens: 5 });
    b.recordLlm("gemini", { inputTokens: 50, outputTokens: 5, thoughtTokens: 0 });
    b.recordLlm("gemini-search", { inputTokens: 10, outputTokens: 1, thoughtTokens: 0 }, 3);
    b.recordMaps("google-maps", 2, "google.routeMatrixElement", 16);
    expect(b.flush()).toEqual([
      { provider: "gemini", calls: 2, inputTokens: 150, outputTokens: 20 },
      { provider: "gemini-search", calls: 3, inputTokens: 10, outputTokens: 1 },
      { provider: "google-maps", calls: 2, inputTokens: 0, outputTokens: 0 },
    ]);
    expect(b.flush()).toEqual([]);
    expect(b.summary()).toMatchObject({ searchQueries: 3, skus: { "google.routeMatrixElement": 16 } });
  });

  it("어댑터 내부 분할·쌍별 호출 수 추정", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: i, lng: i }));
    expect(estimateMatrixCalls("google", pts(11), pts(11), "transit")).toEqual({ calls: 2, units: 121 });
    expect(estimateMatrixCalls("google", pts(5), pts(5), "driving")).toEqual({ calls: 1, units: 25 });
    expect(estimateMatrixCalls("naver", pts(3), pts(3), "driving")).toEqual({ calls: 6, units: 6 });
    expect(estimateMatrixCalls("naver", pts(3), pts(3), "transit")).toEqual({ calls: 0, units: 0 });
    expect(estimateRouteCalls("google", pts(5), "transit")).toBe(4);
    expect(estimateRouteCalls("google", pts(5), "driving")).toBe(1);
    expect(estimateRouteCalls("naver", pts(18), "driving")).toBe(0);
  });
});

describe("fallbackAssignment (LLM 실패 시 대체 배분)", () => {
  const at = (key: string, lat: number, lon: number, extra: Partial<AgentPoi> = {}): AgentPoi => ({ ...poi(key), lat, lon, ...extra });
  // 중심(0,0) 기준 동쪽 묶음 2곳, 서쪽 묶음 2곳
  const pois = [at("E1", 0.01, 1), at("W1", 0.01, -1), at("E2", -0.01, 1), at("W2", -0.01, -1, { category: "museum" })];

  it("이웃한 장소끼리 같은 날에 묶고, 하루 최대 4곳, 범주별 기본 체류시간", () => {
    const { days, warnings } = fallbackAssignment({ dayIndexes: [0, 1], pois });
    expect(warnings).toEqual([]);
    const keys = [0, 1].map((d) => days.get(d)!.stops.map((s) => s.poi.key).sort());
    expect(keys).toContainEqual(["E1", "E2"]);
    expect(keys).toContainEqual(["W1", "W2"]);
    expect(days.get(0)!.stops.length + days.get(1)!.stops.length).toBe(4);
    const museum = [...days.values()].flatMap((d) => d.stops).find((s) => s.poi.key === "W2");
    expect(museum?.stayMins).toBe(90);
  });

  it("관광청 추천·평점 순으로 고르고, 명소가 모자라면 남는 날은 자유 일정", () => {
    const many = Array.from({ length: 10 }, (_, i) => at(`P${i}`, i * 0.001, 0, { rating: i }));
    many.push(at("T", 0, 0.001, { origin: "tourism", rating: undefined }));
    const one = fallbackAssignment({ dayIndexes: [0], pois: many });
    expect(one.days.get(0)!.stops).toHaveLength(FALLBACK_STOPS_PER_DAY);
    expect(one.days.get(0)!.stops.map((s) => s.poi.key)).toContain("T");
    expect(one.days.get(0)!.stops.map((s) => s.poi.key)).not.toContain("P0");

    const sparse = fallbackAssignment({ dayIndexes: [0, 1, 2], pois: pois.slice(0, 2) });
    expect(sparse.days.get(2)).toMatchObject({ title: "자유 일정", stops: [] });
  });
});
