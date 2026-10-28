import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { CreateTripRequest } from "@/lib/schemas";
import { resetDb } from "@/test/integration/db";
import { createPrismaClient, pingDb, type Db } from "./client";
import { createCityRepo } from "./cityRepo";
import { createTripRepo } from "./tripRepo";
import { createUsageRepo } from "./usageRepo";

const dbUrl = inject("dbUrl");

describe.skipIf(!dbUrl)("Repository (SQL Server)", () => {
  let db: Db;
  let trips: ReturnType<typeof createTripRepo>;
  let cities: ReturnType<typeof createCityRepo>;
  let usage: ReturnType<typeof createUsageRepo>;

  const input: CreateTripRequest = { city: "포르투", countryCode: "PT", days: 3, startDate: "2027-05-01", style: "역사", transport: "transit" };

  beforeAll(() => {
    db = createPrismaClient(dbUrl);
    trips = createTripRepo(() => db);
    cities = createCityRepo(() => db);
    usage = createUsageRepo(() => db);
  });
  beforeEach(() => resetDb(db));
  afterAll(() => db?.$disconnect());

  it("pingDb", async () => {
    await expect(pingDb(db)).resolves.toBeUndefined();
  });

  it("생성 → 진행률 갱신 → 상세(ISO 날짜) → 삭제", async () => {
    const created = await trips.createWithDailyLimit(input, { limit: 10 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.trip.id;
    expect(created.trip).toMatchObject({ status: "queued", progress: 0, startDate: "2027-05-01T00:00:00.000Z" });

    await trips.updateProgress(id, { status: "running", progress: 140 });
    expect(await trips.getProgress(id)).toMatchObject({ status: "running", progress: 100 }); // 0~100으로 보정

    const plan = {
      dayIndex: 0, title: "구시가지", date: null, weekday: null, mode: "transit", travelBasis: "transit",
      base: { name: "중심", lat: 41.1, lon: -8.6 }, stops: [], returnTravelMins: 0,
      totals: { travelMins: 0, stayMins: 0, travelRatio: 0 }, dayTripTown: null,
      validation: { passed: true, issues: [] }, needsReview: false, attempts: 1,
    };
    await db.tripDay.create({ data: { tripId: id, dayIndex: 0, title: "구시가지", stops: JSON.stringify(plan) } });
    // 스키마에 맞지 않는 예전 형식 데이터는 상세 응답에서 제외된다
    await db.tripDay.create({ data: { tripId: id, dayIndex: 1, title: "예전 형식", stops: JSON.stringify([{ name: "대성당" }]) } });
    await db.nearbyTown.create({ data: { tripId: id, name: "브라가", travelMins: 50, reason: "역사" } });

    const detail = await trips.getDetail(id);
    expect(detail?.itinerary).toEqual([{ dayIndex: 0, title: "구시가지", stops: plan, routeGeo: null }]);
    expect(detail?.nearbyTowns).toEqual([{ name: "브라가", travelMins: 50, reason: "역사" }]);
    expect(detail?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(await trips.delete(id)).toBe(true);
    expect(await trips.delete(id)).toBe(false);
    expect(await db.tripDay.count()).toBe(0); // cascade
  });

  it("일자 재생성 선점: 완료된 여행만, 작업 중·실패·범위 밖은 거절", async () => {
    const created = await trips.createWithDailyLimit(input, { limit: 10 });
    if (!created.ok) throw new Error("create failed");
    const id = created.trip.id;

    expect(await trips.claimForRegeneration(id, 0)).toBe("busy"); // queued
    await trips.updateProgress(id, { status: "failed", progress: 100 });
    expect(await trips.claimForRegeneration(id, 0)).toBe("failed");
    await trips.updateProgress(id, { status: "done", progress: 100 });
    expect(await trips.claimForRegeneration(id, 3)).toBe("badDay");
    expect(await trips.claimForRegeneration(id, 1)).toBe("ok");
    expect(await trips.getProgress(id)).toMatchObject({ status: "running", step: "assign", progress: 0 });
    expect(await trips.claimForRegeneration(id, 1)).toBe("busy");
    expect(await trips.claimForRegeneration("00000000-0000-0000-0000-000000000000", 0)).toBe("notFound");
  });

  it("일정 조정: 선점 조건·일수/출발일 변경·추천 일수 자동 플래그", async () => {
    const created = await trips.createWithDailyLimit({ ...input, autoDays: true }, { limit: 10 });
    if (!created.ok) throw new Error("create failed");
    const id = created.trip.id;
    expect(created.trip.autoDays).toBe(true);

    expect(await trips.claimForReschedule(id, 4)).toBe("busy"); // queued
    await trips.updateProgress(id, { status: "done", progress: 100 });
    expect(await trips.claimForReschedule(id, 4)).toBe("ok");
    expect(await trips.getProgress(id)).toMatchObject({ status: "running", message: "4일 일정으로 조정 대기" });

    await trips.updateSchedule(id, { days: 4 }); // 출발일 생략 → 유지
    expect(await trips.getDetail(id)).toMatchObject({ days: 4, startDate: "2027-05-01T00:00:00.000Z" });
    await trips.updateSchedule(id, { days: 2, startDate: null });
    expect(await trips.getDetail(id)).toMatchObject({ days: 2, startDate: null });
    expect(await trips.claimForReschedule("00000000-0000-0000-0000-000000000000", 3)).toBe("notFound");
  });

  it("하루 한도: 서울 날짜 기준, 삭제해도 사용량은 남는다", async () => {
    const day1 = new Date("2026-10-27T03:00:00Z"); // 서울 12:00
    for (let i = 0; i < 2; i++) expect((await trips.createWithDailyLimit(input, { limit: 2, now: day1 })).ok).toBe(true);

    const third = await trips.createWithDailyLimit(input, { limit: 2, now: day1 });
    expect(third).toMatchObject({ ok: false, reason: "DAILY_LIMIT_EXCEEDED", usedToday: 2 });

    const { items } = await trips.list({ limit: 10 });
    await trips.delete(items[0].id);
    expect((await trips.createWithDailyLimit(input, { limit: 2, now: day1 })).ok).toBe(false);

    const nextDaySeoul = new Date("2026-10-27T15:30:00Z"); // 서울 10/28 00:30
    expect((await trips.createWithDailyLimit(input, { limit: 2, now: nextDaySeoul })).ok).toBe(true);
    expect(await usage.countTripCreations("2026-10-27")).toBe(2);
  });

  it("동시 생성 요청도 한도를 넘지 않는다 (직렬화 트랜잭션)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => trips.createWithDailyLimit(input, { limit: 3 })),
    );
    const created = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    expect(created).toBeLessThanOrEqual(3);
    expect(await db.trip.count()).toBe(created);
  });

  it("목록 커서 페이지네이션 (최신순)", async () => {
    const base = Date.parse("2026-10-27T00:00:00Z");
    for (let i = 0; i < 5; i++) await trips.createWithDailyLimit(input, { limit: 100, now: new Date(base + i * 1000) });

    const page1 = await trips.list({ limit: 2 });
    const page2 = await trips.list({ limit: 2, cursor: page1.nextCursor! });
    const page3 = await trips.list({ limit: 2, cursor: page2.nextCursor! });
    const all = [...page1.items, ...page2.items, ...page3.items];
    expect(all).toHaveLength(5);
    expect(new Set(all.map((t) => t.id)).size).toBe(5);
    expect(all.map((t) => t.createdAt)).toEqual([...all.map((t) => t.createdAt)].sort().reverse());
    expect(page3.nextCursor).toBeNull();
  });

  it("도시 upsert·캐시 신선도·POI 포함 상세", async () => {
    const now = new Date("2026-10-27T00:00:00Z");
    const background = { history: "항구 도시", culture: null, bestTime: null, etiquette: null, sources: [] };
    const id = await cities.upsert({ name: "포르투", countryCode: "PT", lat: 41.15, lon: -8.61, background }, now);
    expect(await cities.upsert({ name: "포르투", countryCode: "PT", lat: 41.16, lon: -8.62 }, now)).toBe(id);

    await db.poi.create({ data: { cityId: id, name: "볼사 궁전", category: "sight", lat: 41.14, lon: -8.61, hours: JSON.stringify(["월 09:00-18:30"]) } });
    const detail = await cities.getDetail(id);
    expect(detail).toMatchObject({ lat: 41.16, background, refreshedAt: now.toISOString() });
    expect(detail?.pois[0]).toMatchObject({ name: "볼사 궁전", hours: ["월 09:00-18:30"] });

    expect(await cities.findFresh("포르투", "PT", 30, new Date("2026-11-20T00:00:00Z"))).toBe(id);
    expect(await cities.findFresh("포르투", "PT", 30, new Date("2026-12-01T00:00:00Z"))).toBeNull();
  });

  it("공급자별 사용량 합계", async () => {
    await usage.record({ provider: "gemini", inputTokens: 100, outputTokens: 20 });
    await usage.record({ provider: "gemini", inputTokens: 50, outputTokens: 5 });
    await usage.record({ provider: "google-maps", calls: 3 });
    const totals = await usage.dailyTotals(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()));
    expect(totals).toEqual([
      { provider: "gemini", calls: 2, inputTokens: 150, outputTokens: 25 },
      { provider: "google-maps", calls: 3, inputTokens: 0, outputTokens: 0 },
    ]);
  });
});
