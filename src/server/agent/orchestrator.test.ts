/**
 * runTripJob 전체 흐름 — 외부 API(Gemini·Gemini 검색·Google 지도·Naver·Wikipedia)는 MSW로 모킹하고,
 * 실제 어댑터 → 오케스트레이터 → 메모리 저장소까지 그대로 통과시킨다. (DB 포함 버전: orchestrator.int.test.ts)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WikipediaKnowledge } from "@/server/adapters/knowledge/wikipedia";
import { GeminiProvider } from "@/server/adapters/llm/gemini";
import { GoogleMapsProvider } from "@/server/adapters/maps/google";
import { NaverMapsProvider } from "@/server/adapters/maps/naver";
import { GeminiGoogleSearch } from "@/server/adapters/search/geminiGoogleSearch";
import { agentHandlers, type ScenarioOptions } from "@/test/msw/agentScenario";
import { server } from "@/test/msw/server";
import { MemoryAgentStore } from "./memoryStore";
import { KR_TRAVEL_NOTICE, runDayRegeneration, runTripJob } from "./orchestrator";
import type { AgentDeps, AgentLimits } from "./types";

function setup(opts: ScenarioOptions = {}, limits?: Partial<AgentLimits>) {
  const { handlers, counters } = agentHandlers(opts);
  server.use(...handlers);
  const store = new MemoryAgentStore();
  const google = new GoogleMapsProvider({ serverKey: "test" });
  const naver = new NaverMapsProvider({ mapsClientId: "id", mapsClientSecret: "s", searchClientId: "sid", searchClientSecret: "ss" });
  const deps: AgentDeps = {
    store,
    llm: new GeminiProvider({ apiKey: "test", model: "gemini-3.8-flash" }),
    search: new GeminiGoogleSearch({ apiKey: "test", model: "gemini-3.8-flash" }),
    geocoder: google,
    mapsFor: (cc) => (cc === "KR" ? naver : google),
    wiki: new WikipediaKnowledge(),
    limits,
    now: () => new Date("2026-10-27T03:00:00Z"),
  };
  return { store, deps, counters };
}

const porto = { city: "포르투", days: 3, startDate: "2027-05-03", style: "역사,미식", transport: "transit" as const };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("runTripJob — 포르투 (Google)", () => {
  it("7단계를 순서대로 거쳐 일정·근교 도시·사용량을 저장한다", async () => {
    const { store, deps, counters } = setup({ hallucinateKey: true });
    const id = store.createTrip(porto);
    await runTripJob(id, deps);

    const trip = (await store.getTrip(id))!;
    const meta = (await store.getMeta(id))!;
    expect(trip.status).toBe("done");
    expect(store.trips.get(id)!.errorMessage).toBeNull();

    // 진행 이벤트: 단계 순서와 진행률 단조 증가
    const log = store.progressLog.filter((p) => p.tripId === id);
    const steps = [...new Set(log.map((p) => p.step))];
    expect(steps).toEqual(["normalize", "cache", "collect", "assign", "optimize", "validate", "save", "done"]);
    const progress = log.map((p) => p.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(log.every((p) => p.message.length > 0)).toBe(true);

    // 도시: 역사(위키 출처), 관광청(공식 도메인 우선), POI 중복 제거 (추천 2곳이 검색 결과와 병합)
    const city = (await store.getCity(trip.cityId!))!;
    expect(city.background?.sources[0].url).toContain("wikipedia.org");
    expect(city.tourismBoard?.sources[0]).toMatchObject({ url: "https://www.visitporto.travel/pt-PT", official: true });
    expect(city.tourismBoard?.sources.at(-1)?.official).toBe(false);
    expect(city.tourismBoard?.recommended).toEqual(["Palácio da Bolsa", "Torre dos Clérigos"]);
    expect(city.pois).toHaveLength(10);
    expect(city.pois.filter((p) => /볼사|Bolsa/.test(p.name))).toHaveLength(1);

    // 일정: 3일, 모든 방문지는 주어진 POI이며 좌표·출처 보유, 경로선 존재
    const days = await store.getDays(id);
    expect(days.map((d) => d.dayIndex)).toEqual([0, 1, 2]);
    const poiNames = new Set(city.pois.map((p) => p.name));
    for (const d of days) {
      expect(d.stops.length).toBeGreaterThan(0);
      for (const s of d.stops) {
        expect(poiNames.has(s.name)).toBe(true);
        expect(Number.isFinite(s.lat) && Number.isFinite(s.lon)).toBe(true);
        expect(s.sourceUrl).toMatch(/^https:/);
      }
      expect(d.routeGeo?.coordinates.length).toBeGreaterThan(2);
      expect(d.stops[0].arrive >= "09:00").toBe(true);
      expect(d.validation.passed).toBe(true);
    }

    // 검증 재시도: day 0(월)에 월요일 휴무 미술관이 배정됐다가 재배치됨
    expect(days[0].attempts).toBe(2);
    expect(days[0].stops.some((s) => s.name.includes("미술관"))).toBe(false);
    expect(counters.gemini.assignment).toBe(2);

    // 환각 키(P99)는 버려지고 경고로 남음
    expect(meta.warnings.some((w) => w.includes("P99"))).toBe(true);

    // 근교: 150km 밖(리스본)·120분 초과·후보에 없는 이름 제외, 당일치기/1박 구분
    const nearby = await store.getNearby(id);
    expect(nearby.map((t) => t.name).sort()).toEqual(["기마랑이스", "브라가", "아베이루"].sort());
    expect(nearby.find((t) => t.name === "브라가")?.kind).toBe("dayTrip");
    expect(nearby.find((t) => t.name === "아베이루")?.kind).toBe("overnight");
    expect(meta.warnings.some((w) => w.includes("가짜도시"))).toBe(true);

    // 사용량: 지도 호출 추정치가 실제 HTTP 호출 수와 일치, UsageLog 기록
    expect(meta.usage?.mapsCalls).toBe(counters.geocode + counters.places + counters.matrix + counters.routes);
    expect(meta.usage?.geminiCalls).toBe(6);
    const providers = new Set(store.usage.map((u) => u.provider));
    expect(providers).toEqual(new Set(["gemini", "gemini-search", "google-maps"]));
    expect(store.usage.filter((u) => u.provider === "gemini").reduce((s, u) => s + u.inputTokens, 0)).toBeGreaterThan(0);

    expect(meta.travelBasisNotice).toBeNull();
    expect(meta.cache.hit).toBe(false);
  });

  it("30일 이내 같은 도시는 역사·관광청·POI 수집을 건너뛴다 (캐시)", async () => {
    const { store, deps, counters } = setup();
    await runTripJob(store.createTrip(porto), deps);
    const before = { wiki: counters.wiki, places: counters.places, search: counters.gemini.search, history: counters.gemini.history };

    const second = store.createTrip({ ...porto, days: 2 });
    await runTripJob(second, deps);

    expect((await store.getTrip(second))!.status).toBe("done");
    expect((await store.getMeta(second))!.cache.hit).toBe(true);
    expect({ wiki: counters.wiki, places: counters.places, search: counters.gemini.search, history: counters.gemini.history }).toEqual(before);
    expect(await store.getDays(second)).toHaveLength(2);
  });

  it("Gemini 호출 상한을 넘으면 중단하고 부분 결과를 저장한다", async () => {
    const { store, deps } = setup({}, { maxGeminiCalls: 4 });
    const id = store.createTrip(porto);
    await runTripJob(id, deps);

    const t = store.trips.get(id)!;
    expect(t.status).toBe("done");
    expect(t.errorMessage).toMatch(/Gemini 호출 상한\(4회\)/);
    expect(t.meta?.partial).toBe(true);
    expect(t.cityId).not.toBeNull(); // 수집한 도시 정보는 저장됨
    expect(store.usage.length).toBeGreaterThan(0);
  });

  it("도시를 찾지 못하면 failed + 사용자용 메시지", async () => {
    const { store, deps } = setup();
    const id = store.createTrip({ ...porto, city: "없는도시" });
    await runTripJob(id, deps);
    expect(store.trips.get(id)).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("없는도시") });
  });
});

describe("runTripJob — 경주 (Naver, 국내)", () => {
  it("Naver 지도로 자동차 기준 동선을 만들고 근교 도시는 건너뛴다", async () => {
    const { store, deps, counters } = setup();
    const id = store.createTrip({ city: "경주", days: 2, style: "역사", transport: "transit" });
    await runTripJob(id, deps);

    const meta = (await store.getMeta(id))!;
    expect(store.trips.get(id)!.status).toBe("done");
    expect(meta.countryCode).toBe("KR");
    expect(meta.travelBasisNotice).toBe(KR_TRAVEL_NOTICE);
    expect(await store.getNearby(id)).toEqual([]);
    expect(counters.places).toBe(0); // Google Places 미사용
    expect(counters.naverLocal).toBeGreaterThan(0);
    expect(counters.naverDirections15).toBe(2);

    const days = await store.getDays(id);
    for (const d of days) {
      expect(d.mode).toBe("driving");
      expect(d.travelBasis).toBe("driving");
      expect(d.stops.every((s) => s.sourceUrl?.startsWith("https://map.naver.com/"))).toBe(true);
    }
    // Naver 행렬은 상삼각만 호출: 일자별 (n+1)n/2 쌍
    const expectedPairs = days.reduce((s, d) => s + ((d.stops.length + 1) * d.stops.length) / 2, 0);
    expect(counters.naverDirections5).toBe(expectedPairs);
    expect(new Set(store.usage.map((u) => u.provider)).has("naver")).toBe(true);
  });
});

describe("runDayRegeneration", () => {
  it("해당 일자만 다시 배분하고 다른 일자에 쓴 POI는 피한다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const before = await store.getDays(id);

    await runDayRegeneration(id, 1, deps);
    const after = await store.getDays(id);

    expect(store.trips.get(id)).toMatchObject({ status: "done", errorMessage: null, stepMessage: "day 2 재생성 완료" });
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    const others = new Set([...after[0].stops, ...after[2].stops].map((s) => s.name));
    expect(after[1].stops.some((s) => others.has(s.name))).toBe(false);
  });
});
