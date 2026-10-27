/**
 * API 라우트 통합 테스트: 실제 라우트 핸들러 + 실제 Repository + Testcontainers SQL Server.
 * (인증은 proxy.ts가 라우트 앞에서 처리하므로 proxy.test.ts에서 따로 검증한다)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { getPrisma } from "@/server/db";
import { resetDb } from "@/test/integration/db";
import { agentHandlers } from "@/test/msw/agentScenario";
import { server } from "@/test/msw/server";
import { GET as healthz } from "./healthz/route";
import { GET as getCity } from "./v1/cities/[id]/route";
import { DELETE as deleteTrip, GET as getTrip } from "./v1/trips/[id]/route";
import { GET as events } from "./v1/trips/[id]/events/route";
import { POST as regenerate } from "./v1/trips/[id]/days/[dayIndex]/regenerate/route";
import { GET as listTrips, POST as createTrip } from "./v1/trips/route";

// 라우트가 띄우는 에이전트를 운영 저장소(Prisma) + MSW 외부 API로 실행한다 (운영 env 키 불필요)
vi.mock("@/server/agent/runtime", async () => {
  const { runTripJob, runDayRegeneration } = await import("@/server/agent/orchestrator");
  const { agentStore } = await import("@/server/db/agentStore");
  const { createTestDeps } = await import("@/test/agentDeps");
  const deps = () => createTestDeps(agentStore);
  return {
    startTripJob: (id: string) => void runTripJob(id, deps()),
    startDayRegeneration: (id: string, day: number) => void runDayRegeneration(id, day, deps()),
  };
});

const dbUrl = inject("dbUrl");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const body = { city: "포르투", countryCode: "PT", days: 2, startDate: "2027-05-03", style: "역사", transport: "transit" };
const post = () =>
  new Request("http://x/api/v1/trips", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe.skipIf(!dbUrl)("API 라우트 (SQL Server)", () => {
  beforeAll(() => {
    // 라우트가 쓰는 전역 Prisma 싱글턴을 테스트 컨테이너로 향하게 한다 (첫 getPrisma() 호출 전에 설정)
    vi.stubEnv("DATABASE_URL", dbUrl);
    vi.stubEnv("DAILY_TRIP_LIMIT", "3");
    server.listen({ onUnhandledFrame: "bypass" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  beforeEach(async () => {
    server.resetHandlers();
    server.use(...agentHandlers().handlers);
    await resetDb(getPrisma());
  });
  afterAll(async () => {
    server.close();
    await getPrisma().$disconnect();
    vi.unstubAllEnvs();
  });

  it("healthz: 실제 DB 연결 확인", async () => {
    const res = await healthz(new Request("http://x/api/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  const sse = async (tripId: string) => {
    const text = await (await events(new Request("http://x"), ctx(tripId))).text();
    return [...text.matchAll(/data: (.+)/g)].map((m) => JSON.parse(m[1]));
  };

  it("POST 202 → 에이전트 실행 → SSE { step, message, progress } → 상세 → 일자 재생성 → DELETE", async () => {
    const created = await createTrip(post());
    expect(created.status).toBe(202);
    const { tripId } = await created.json();

    // 작업이 done이 되면 서버가 스트림을 닫는다
    const events1 = await sse(tripId);
    expect(events1.at(-1)).toMatchObject({ status: "done", step: "done", progress: 100 });
    expect(events1.every((e) => typeof e.message === "string")).toBe(true);

    const detail = await (await getTrip(new Request("http://x"), ctx(tripId))).json();
    expect(detail).toMatchObject({ id: tripId, status: "done", progress: 100 });
    expect(detail.itinerary).toHaveLength(2);
    expect(detail.city.countryCode).toBe("PT");
    expect(new Date(detail.createdAt).toISOString()).toBe(detail.createdAt);

    // 일자 재생성: 202 → 작업 중 409 → 완료
    const regen = await regenerate(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: tripId, dayIndex: "1" }) });
    expect(regen.status).toBe(202);
    const busy = await regenerate(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: tripId, dayIndex: "0" }) });
    expect(busy.status).toBe(409);
    expect((await sse(tripId)).at(-1)).toMatchObject({ status: "done", message: "day 2 재생성 완료" });

    const list = await (await listTrips(new Request("http://x/api/v1/trips"))).json();
    expect(list.items.map((t: { id: string }) => t.id)).toContain(tripId);

    expect((await deleteTrip(new Request("http://x"), ctx(tripId))).status).toBe(204);
    expect((await getTrip(new Request("http://x"), ctx(tripId))).status).toBe(404);
  }, 30_000);

  it("DAILY_TRIP_LIMIT(3) 초과 시 429", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await createTrip(post());
      expect(res.status).toBe(202);
      ids.push((await res.json()).tripId);
    }
    const res = await createTrip(post());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "DAILY_LIMIT_EXCEEDED" });
    for (const id of ids) await sse(id); // 백그라운드 작업이 끝날 때까지 기다려 다음 테스트와 섞이지 않게 한다
  }, 60_000);

  it("없는 도시는 404 { code, message }", async () => {
    const res = await getCity(new Request("http://x"), ctx("6f1d3c2a-8a51-4c7e-9d7e-2b8f3a9c1e10"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NOT_FOUND", message: expect.any(String) });
  });
});
