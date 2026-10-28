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
import type { LlmProvider } from "@/server/adapters/llm/types";
import { MemoryAgentStore } from "./memoryStore";
import { ASSIGN_FALLBACK_WARNING, KR_TRAVEL_NOTICE, runDayRegeneration, runReschedule, runTripJob } from "./orchestrator";
import { ASSIGNMENT_TOOL_NAME } from "./prompts/assignment";
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

  it("다른 일자의 당일치기 도시는 다시 배정하지 않는다", async () => {
    const { store, deps } = setup();
    // 배분 결과에서 target 일자에 근교 도시(브라가)를 넣는 LLM 래퍼
    let target = 0;
    const llm: LlmProvider = {
      async generate(req) {
        const res = await deps.llm.generate(req);
        const call = res.functionCalls.find((c) => c.name === ASSIGNMENT_TOOL_NAME);
        for (const d of (call?.args.days as { dayIndex: number; dayTripTown: string | null }[] | undefined) ?? []) {
          if (d.dayIndex === target) d.dayTripTown = "브라가";
        }
        return res;
      },
    };
    const id = store.createTrip(porto);
    await runTripJob(id, { ...deps, llm });
    expect((await store.getDays(id))[0].dayTripTown).toBe("브라가");

    target = 1;
    await runDayRegeneration(id, 1, { ...deps, llm });
    const after = await store.getDays(id);
    expect(after[0].dayTripTown).toBe("브라가");
    expect(after[1].dayTripTown).toBeNull();
    expect((await store.getMeta(id))!.warnings.some((w) => w.includes("브라가") && w.includes("무시"))).toBe(true);
  });

  it("비용 상한으로 중단돼도 다른 일자의 검증 필요 표시를 유지한다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    // day 0을 검증 필요 상태로 만든다
    const [day0] = await store.getDays(id);
    await store.saveDays(id, [{ ...day0, needsReview: true }]);
    store.trips.get(id)!.meta!.needsReviewDays = [0];
    const before = await store.getDays(id);

    await runDayRegeneration(id, 1, { ...deps, limits: { maxGeminiCalls: 0 } });

    const t = store.trips.get(id)!;
    expect(t.status).toBe("done");
    expect(t.errorMessage).toMatch(/Gemini 호출 상한/);
    expect(t.meta!.needsReviewDays).toEqual([0]);
    expect(await store.getDays(id)).toEqual(before); // 새 일정이 없으므로 기존 일자 그대로
  });
});

describe("장애 대응 (fallback)", () => {
  /** 일자 배분(submitItinerary 도구) 요청만 실패시키는 LLM 래퍼 */
  const failAssignment = (deps: AgentDeps): LlmProvider => ({
    async generate(req) {
      const isAssignment = req.tools?.some((t) => t.name === ASSIGNMENT_TOOL_NAME) || req.systemInstruction?.includes("결과는 JSON으로만 답한다");
      if (isAssignment) throw Object.assign(new Error("UNAVAILABLE"), { status: 503 });
      return deps.llm.generate(req);
    },
  });

  it("LLM 일자 배분이 실패해도 거리 기준 대체 배분으로 일정을 완성한다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, { ...deps, llm: failAssignment(deps) });

    const t = store.trips.get(id)!;
    expect(t.status).toBe("done");
    expect(t.meta!.warnings).toContain(ASSIGN_FALLBACK_WARNING);
    const days = await store.getDays(id);
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.stops.length > 0)).toBe(true);
    const keys = days.flatMap((d) => d.stops.map((s) => s.name));
    expect(new Set(keys).size).toBe(keys.length); // 같은 명소를 두 번 배정하지 않는다
  });

  it("진행 기록이 한두 번 실패해도 작업은 끝까지 진행한다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    const original = store.updateProgress.bind(store);
    let calls = 0;
    store.updateProgress = async (tripId, u) => {
      if (++calls % 5 === 2) throw new Error("deadlock victim"); // 간헐적 실패 (연속 아님)
      return original(tripId, u);
    };
    await runTripJob(id, deps);
    expect(store.trips.get(id)!.status).toBe("done");
  });

  it("진행 기록이 연속으로 실패하면(DB 장애) 작업을 failed로 끝낸다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    store.updateProgress = async () => {
      throw new Error("db down");
    };
    await runTripJob(id, deps);
    expect(store.trips.get(id)).toMatchObject({ status: "failed", errorMessage: expect.stringContaining("오류가 발생했습니다") });
  });
});

describe("배경지식 보완 (AI 요약 정보)", () => {
  it("원문에 없는 항목은 일반 지식으로 채우고 aiFields로 표시한다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const bg = (await store.getCity(store.trips.get(id)!.cityId!))!.background!;
    expect(bg.bestTime).toBeTruthy();
    expect(bg.etiquette).toBeTruthy();
    expect(bg.aiFields).toEqual(["bestTime", "etiquette"]);
    expect(bg.sources[0].url).toContain("wikipedia.org");
  });

  it("위키 문서가 없어도 비우지 않고, 채운 항목은 모두 AI 요약 정보가 된다", async () => {
    const { store, deps, counters } = setup({ noWiki: true });
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const bg = (await store.getCity(store.trips.get(id)!.cityId!))!.background!;
    expect(counters.gemini.history).toBe(1); // 원문이 없어도 요약을 만든다
    expect(bg.sources).toEqual([]);
    expect(bg.history).toBeTruthy();
    expect(bg.aiFields.sort()).toEqual(["bestTime", "culture", "etiquette", "history"]);
  });
});

describe("관광청 정보 대체 출처", () => {
  const tourismOf = async (store: MemoryAgentStore, id: string) => (await store.getCity(store.trips.get(id)!.cityId!))!.tourismBoard!;

  it("공식 관광청 정보가 충분하면 검색 1회로 끝낸다", async () => {
    const { store, deps, counters } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    expect(counters.gemini.search).toBe(1);
    expect((await tourismOf(store, id)).sourceType).toBe("official");
  });

  it("공식 사이트가 없으면 대체 출처(위키여행·여행 플랫폼)를 더 검색해 합친다", async () => {
    const { store, deps, counters } = setup({ tourism: "thin" });
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const t = await tourismOf(store, id);
    expect(counters.gemini.search).toBe(2);
    expect(t.sourceType).toBe("alternative");
    expect(t.summary).toContain("위키여행 기준");
    expect(t.recommended).toEqual(["Torre dos Clérigos", "Ribeira", "Livraria Lello"]); // 중복 없이 합침
    expect(t.sources.map((s) => s.url)).toContain("https://en.wikivoyage.org/wiki/Porto");
    expect(t.searchEntryPointHtml).toContain("alt"); // 두 검색의 검색 추천을 모두 표시
    expect(t.searchEntryPointHtml).toContain("first");
  });

  it("검색이 모두 실패하면 위키여행 요약으로 최소 정보를 만든다 (경고 없음)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { store, deps } = setup({ tourism: "fail" });
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const t = await tourismOf(store, id);
    expect(t).toMatchObject({ sourceType: "alternative", recommended: [], searchEntryPointHtml: null });
    expect(t.summary).toContain("리베이라");
    expect(t.sources[0].url).toContain("wikivoyage.org");
    expect(store.trips.get(id)!.meta!.warnings.some((w) => w.includes("관광청 조사"))).toBe(false);
  });
});

describe("추천 체류 일수·일정 조정", () => {
  it("결과 meta에 추천 체류 일수를 남긴다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const stay = store.trips.get(id)!.meta!.recommendedStay!;
    expect(stay.days).toBeGreaterThanOrEqual(2);
    expect(stay.nights).toBe(stay.days - 1);
    expect(stay.reason).toMatch(/명소·박물관 \d+곳/);
  });

  it("추천 일수로 자동: 여행 일수를 추천값으로 바꿔 그 일수만큼 일정을 만든다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip({ ...porto, days: 1, autoDays: true });
    await runTripJob(id, deps);
    const t = store.trips.get(id)!;
    const stay = t.meta!.recommendedStay!;
    expect(t.status).toBe("done");
    expect(t.days).toBe(stay.days);
    expect(await store.getDays(id)).toHaveLength(stay.days);
    expect(t.meta!.notices.some((n) => n.includes("추천 체류 일수"))).toBe(true);
  });

  it("일정 조정: 일수·출발일을 바꾸고 사용자 요청을 배분에 넘겨 일정 전체를 다시 만든다", async () => {
    const { store, deps, counters } = setup();
    const id = store.createTrip(porto); // 3일, 2027-05-03 출발
    await runTripJob(id, deps);

    await runReschedule(id, { days: 2, startDate: null, request: "둘째 날은 미술관 위주" }, deps);

    const t = store.trips.get(id)!;
    expect(t).toMatchObject({ status: "done", errorMessage: null, days: 2, startDate: null, stepMessage: "1박 2일 일정으로 조정 완료" });
    const days = await store.getDays(id);
    expect(days.map((d) => d.dayIndex)).toEqual([0, 1]); // 3일차는 지워진다
    expect(days.every((d) => d.date === null)).toBe(true);
    expect(counters.lastAssignmentPrompt).toContain("사용자 요청");
    expect(counters.lastAssignmentPrompt).toContain("둘째 날은 미술관 위주");
  });

  it("일정 조정 중 비용 상한에 걸리면 기존 일정·일수를 그대로 둔다", async () => {
    const { store, deps } = setup();
    const id = store.createTrip(porto);
    await runTripJob(id, deps);
    const before = await store.getDays(id);

    await runReschedule(id, { days: 5 }, { ...deps, limits: { maxGeminiCalls: 0 } });

    const t = store.trips.get(id)!;
    expect(t).toMatchObject({ status: "done", days: 3, startDate: "2027-05-03" });
    expect(t.errorMessage).toMatch(/기존 일정을 유지/);
    expect(await store.getDays(id)).toEqual(before);
  });
});
