/**
 * runTripJob 전체 흐름 (실제 SQL Server + Prisma AgentStore). 외부 API는 MSW.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { createPrismaClient, createTripRepo, type Db } from "@/server/db";
import { createAgentStore } from "@/server/db/agentStore";
import { createTestDeps } from "@/test/agentDeps";
import { resetDb } from "@/test/integration/db";
import { agentHandlers } from "@/test/msw/agentScenario";
import { server } from "@/test/msw/server";
import { runDayRegeneration, runTripJob } from "./orchestrator";

const dbUrl = inject("dbUrl");

describe.skipIf(!dbUrl)("에이전트 + SQL Server", () => {
  let db: Db;
  const porto = { city: "포르투", days: 3, startDate: "2027-05-03", style: "역사", transport: "transit" as const };

  beforeAll(() => {
    db = createPrismaClient(dbUrl);
    server.listen({ onUnhandledFrame: "bypass" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  beforeEach(async () => {
    server.resetHandlers();
    server.use(...agentHandlers().handlers);
    await resetDb(db);
  });
  afterAll(async () => {
    server.close();
    await db?.$disconnect();
  });

  it("도시·POI·일정·근교 도시·사용량을 DB에 저장하고, 상세 API 형태로 읽힌다", async () => {
    const trips = createTripRepo(() => db);
    const created = await trips.createWithDailyLimit(porto, { limit: 10 });
    if (!created.ok) throw new Error("limit");
    const deps = createTestDeps(createAgentStore(() => db));

    await runTripJob(created.trip.id, deps);

    const detail = (await trips.getDetail(created.trip.id))!;
    expect(detail).toMatchObject({ status: "done", step: "done", progress: 100, errorMessage: null });
    expect(detail.itinerary).toHaveLength(3);
    expect(detail.nearbyTowns.find((t) => t.name === "브라가")?.reason).toMatch(/^\[당일치기\]/);
    expect((detail.meta as { usage: { geminiCalls: number } }).usage.geminiCalls).toBeGreaterThan(0);
    const day0 = detail.itinerary[0] as { stops: { stops: { sourceUrl: string }[] }; routeGeo: { type: string } };
    expect(day0.stops.stops.every((s) => s.sourceUrl.startsWith("https://"))).toBe(true);
    expect(day0.routeGeo.type).toBe("LineString");

    expect(await db.poi.count()).toBe(10);
    const usage = await db.usageLog.groupBy({ by: ["provider"], where: { tripId: created.trip.id }, _sum: { calls: true } });
    expect(usage.map((u) => u.provider).sort()).toEqual(["gemini", "gemini-search", "google-maps", "trip"]);

    // 일자 재생성은 해당 일자만 교체
    const before = await db.tripDay.findMany({ where: { tripId: created.trip.id }, orderBy: { dayIndex: "asc" } });
    await runDayRegeneration(created.trip.id, 2, deps);
    const after = await db.tripDay.findMany({ where: { tripId: created.trip.id }, orderBy: { dayIndex: "asc" } });
    expect(after[0].stops).toBe(before[0].stops);
    expect(after[1].stops).toBe(before[1].stops);
    expect((await trips.getProgress(created.trip.id))?.status).toBe("done");
  });

  it("10분 넘게 멈춘 running 작업을 failed로 정리한다", async () => {
    const trips = createTripRepo(() => db);
    const created = await trips.createWithDailyLimit(porto, { limit: 10 });
    if (!created.ok) throw new Error("limit");
    await db.trip.update({ where: { id: created.trip.id }, data: { status: "running", updatedAt: new Date(Date.now() - 11 * 60_000) } });
    const fresh = await trips.createWithDailyLimit(porto, { limit: 10 });
    if (!fresh.ok) throw new Error("limit");
    await trips.updateProgress(fresh.trip.id, { status: "running", progress: 30 });

    expect(await trips.failStale(new Date(Date.now() - 10 * 60_000))).toBe(1);
    expect((await trips.getProgress(created.trip.id))?.status).toBe("failed");
    expect((await trips.getProgress(fresh.trip.id))?.status).toBe("running");
  });
});
