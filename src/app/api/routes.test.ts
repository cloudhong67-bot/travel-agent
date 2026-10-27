/**
 * 라우트 핸들러 단위 테스트 — Repository를 목으로 바꿔 HTTP 계약(상태 코드·오류 형식)만 검증한다.
 * 실제 DB 검증은 routes.int.test.ts (Testcontainers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  tripRepo: {
    createWithDailyLimit: vi.fn(),
    list: vi.fn(),
    getDetail: vi.fn(),
    getProgress: vi.fn(),
    updateProgress: vi.fn(),
    claimForRegeneration: vi.fn(),
    delete: vi.fn(),
  },
  cityRepo: { getDetail: vi.fn() },
  pingDb: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ startTripJob: vi.fn(), startDayRegeneration: vi.fn() }));
vi.mock("@/server/db", () => repo);
vi.mock("@/server/agent/runtime", () => runtime);

import { GET as getCity } from "./v1/cities/[id]/route";
import { GET as healthz } from "./healthz/route";
import { POST as unlock } from "./unlock/route";
import { DELETE as deleteTrip, GET as getTrip } from "./v1/trips/[id]/route";
import { GET as events } from "./v1/trips/[id]/events/route";
import { POST as regenerate } from "./v1/trips/[id]/days/[dayIndex]/regenerate/route";
import { GET as listTrips, POST as createTrip } from "./v1/trips/route";
import { GET as openapi } from "./v1/openapi.json/route";

const ID = "6f1d3c2a-8a51-4c7e-9d7e-2b8f3a9c1e10";
const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) });
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const summary = {
  id: ID,
  cityName: "포르투",
  countryCode: "PT",
  cityId: null,
  days: 5,
  startDate: null,
  style: "역사",
  transport: "transit",
  status: "queued",
  progress: 0,
  createdAt: "2026-10-27T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("DAILY_TRIP_LIMIT", "10");
  vi.stubEnv("APP_ACCESS_TOKEN", "test-access-token-0123456789");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/v1/trips", () => {
  const body = { city: "포르투", days: 5, style: "역사", transport: "transit" };

  it("202 + tripId + Location", async () => {
    repo.tripRepo.createWithDailyLimit.mockResolvedValue({ ok: true, trip: summary });
    const res = await createTrip(post("http://x/api/v1/trips", body));
    expect(res.status).toBe(202);
    expect(res.headers.get("location")).toBe(`/api/v1/trips/${ID}`);
    expect(await res.json()).toEqual({ tripId: ID, status: "queued", eventsUrl: `/api/v1/trips/${ID}/events` });
    expect(repo.tripRepo.createWithDailyLimit).toHaveBeenCalledWith(body, { limit: 10 });
    expect(runtime.startTripJob).toHaveBeenCalledWith(ID); // 에이전트는 시작만 하고 기다리지 않는다
  });

  it("한도 초과는 429 DAILY_LIMIT_EXCEEDED", async () => {
    repo.tripRepo.createWithDailyLimit.mockResolvedValue({
      ok: false,
      reason: "DAILY_LIMIT_EXCEEDED",
      usedToday: 10,
      limit: 10,
    });
    const res = await createTrip(post("http://x/api/v1/trips", body));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "DAILY_LIMIT_EXCEEDED" });
  });

  it("잘못된 입력·JSON이 아닌 바디는 400 VALIDATION_ERROR", async () => {
    runtime.startTripJob.mockClear();
    const bad = await createTrip(post("http://x/api/v1/trips", { ...body, days: 0 }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ code: "VALIDATION_ERROR", message: expect.stringContaining("days") });

    const notJson = await createTrip(new Request("http://x/api/v1/trips", { method: "POST", body: "{" }));
    expect(notJson.status).toBe(400);
    expect(repo.tripRepo.createWithDailyLimit).not.toHaveBeenCalled();
    expect(runtime.startTripJob).not.toHaveBeenCalled();
  });

  it("예상치 못한 오류는 내부 메시지를 숨기고 500 INTERNAL_ERROR", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    repo.tripRepo.createWithDailyLimit.mockRejectedValue(new Error("connection string leaked"));
    const res = await createTrip(post("http://x/api/v1/trips", body));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("INTERNAL_ERROR");
    expect(json.message).not.toContain("leaked");
  });
});

describe("GET /api/v1/trips", () => {
  it("쿼리를 검증해 repo에 넘긴다", async () => {
    repo.tripRepo.list.mockResolvedValue({ items: [summary], nextCursor: null });
    const res = await listTrips(new Request("http://x/api/v1/trips?limit=5"));
    expect(res.status).toBe(200);
    expect(repo.tripRepo.list).toHaveBeenCalledWith({ limit: 5 });
    expect((await listTrips(new Request("http://x/api/v1/trips?limit=999"))).status).toBe(400);
  });
});

describe("/api/v1/trips/{id}", () => {
  it("GET 상세 200 / 없으면 404 / 잘못된 id 400", async () => {
    repo.tripRepo.getDetail.mockResolvedValueOnce({ ...summary, errorMessage: null, city: null, itinerary: [], nearbyTowns: [] });
    expect((await getTrip(new Request("http://x"), ctx({ id: ID }))).status).toBe(200);

    repo.tripRepo.getDetail.mockResolvedValueOnce(null);
    const missing = await getTrip(new Request("http://x"), ctx({ id: ID }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });

    expect((await getTrip(new Request("http://x"), ctx({ id: "nope" }))).status).toBe(400);
  });

  it("DELETE 204 / 없으면 404", async () => {
    repo.tripRepo.delete.mockResolvedValueOnce(true);
    expect((await deleteTrip(new Request("http://x"), ctx({ id: ID }))).status).toBe(204);
    repo.tripRepo.delete.mockResolvedValueOnce(false);
    expect((await deleteTrip(new Request("http://x"), ctx({ id: ID }))).status).toBe(404);
  });
});

describe("GET /api/v1/trips/{id}/events (SSE)", () => {
  it("변경될 때마다 { step, message, progress } 이벤트를 보내고 done에서 닫는다", async () => {
    const e = (status: string, step: string, message: string, progress: number) => ({ tripId: ID, status, step, message, progress, errorMessage: null });
    repo.tripRepo.getProgress
      .mockResolvedValueOnce(e("running", "normalize", "위치 확인 중", 2))
      .mockResolvedValueOnce(e("running", "normalize", "위치 확인 중", 2)) // 변화 없음 → 전송 안 함
      .mockResolvedValueOnce(e("running", "collect", "관광청 조사 완료 (2/4)", 29))
      .mockResolvedValueOnce(e("done", "done", "완료", 100));

    const res = await events(new Request("http://x"), ctx({ id: ID }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const sent = [...text.matchAll(/event: progress\ndata: (.+)\n/g)].map((m) => JSON.parse(m[1]));
    expect(sent.map((s) => [s.step, s.progress])).toEqual([["normalize", 2], ["collect", 29], ["done", 100]]);
    expect(sent[1].message).toBe("관광청 조사 완료 (2/4)");
  });

  it("없는 여행은 스트림을 열지 않고 404", async () => {
    repo.tripRepo.getProgress.mockResolvedValueOnce(null);
    expect((await events(new Request("http://x"), ctx({ id: ID }))).status).toBe(404);
  });
});

describe("기타 엔드포인트", () => {
  it("regenerate: 202로 시작 / 없음 404 / 작업 중 409 / 범위 밖 400", async () => {
    const call = () => regenerate(new Request("http://x", { method: "POST" }), ctx({ id: ID, dayIndex: "1" }));

    repo.tripRepo.claimForRegeneration.mockResolvedValueOnce("ok");
    const ok = await call();
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ tripId: ID, dayIndex: 1, status: "running", eventsUrl: `/api/v1/trips/${ID}/events` });
    expect(runtime.startDayRegeneration).toHaveBeenCalledWith(ID, 1);

    runtime.startDayRegeneration.mockClear();
    for (const [claim, status, code] of [["notFound", 404, "NOT_FOUND"], ["busy", 409, "CONFLICT"], ["badDay", 400, "VALIDATION_ERROR"]] as const) {
      repo.tripRepo.claimForRegeneration.mockResolvedValueOnce(claim);
      const res = await call();
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
    }
    expect(runtime.startDayRegeneration).not.toHaveBeenCalled();
  });

  it("cities/{id} 200 / 404", async () => {
    repo.cityRepo.getDetail.mockResolvedValueOnce({ id: ID });
    expect((await getCity(new Request("http://x"), ctx({ id: ID }))).status).toBe(200);
    repo.cityRepo.getDetail.mockResolvedValueOnce(null);
    expect((await getCity(new Request("http://x"), ctx({ id: ID }))).status).toBe(404);
  });

  it("healthz: DB 정상 200 / 실패 503 / shallow는 DB 미확인", async () => {
    repo.pingDb.mockResolvedValueOnce(undefined);
    expect(await (await healthz(new Request("http://x/api/healthz"))).json()).toMatchObject({ status: "ok", db: "ok" });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    repo.pingDb.mockRejectedValueOnce(new Error("down"));
    const down = await healthz(new Request("http://x/api/healthz"));
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ code: "DB_UNAVAILABLE" });

    repo.pingDb.mockClear();
    const shallow = await healthz(new Request("http://x/api/healthz?shallow=1"));
    expect(await shallow.json()).toMatchObject({ db: "skipped" });
    expect(repo.pingDb).not.toHaveBeenCalled();
  });

  it("openapi.json은 OpenAPI 3.1 문서", async () => {
    const doc = await openapi().json();
    expect(doc.openapi).toBe("3.1.0");
  });
});

describe("POST /api/unlock", () => {
  const form = (fields: Record<string, string>) =>
    new Request("https://app.example/api/unlock", { method: "POST", body: new URLSearchParams(fields) });

  it("맞는 토큰이면 httpOnly·Secure 쿠키를 설정하고 next로 303", async () => {
    const res = await unlock(form({ token: "test-access-token-0123456789", next: "/trips" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/trips");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^tp_access=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("틀린 토큰이면 쿠키 없이 /unlock?error=1, 외부 next는 무시", async () => {
    vi.useFakeTimers();
    const pending = unlock(form({ token: "wrong", next: "https://evil.example" }));
    await vi.advanceTimersByTimeAsync(500);
    const res = await pending;
    vi.useRealTimers();
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toBeNull();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/unlock");
    expect(location.searchParams.get("error")).toBe("1");
    expect(location.searchParams.get("next")).toBeNull();
  });
});
