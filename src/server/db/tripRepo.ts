import { Prisma } from "@/generated/prisma/client";
import type {
  AgentStep,
  Budget,
  CreateTripRequest,
  ProgressEvent,
  TripDetail,
  TripStatus,
  TripSummary,
} from "@/lib/schemas";
import { isDailyLimitExceeded, seoulDateKey } from "@/server/limits";
import { getPrisma, type Db } from "./client";
import { DayPlanSchema, GeoLineStringSchema, TripMetaSchema } from "@/lib/schemas";
import { parseJsonColumnAs } from "./json";
import { createUsageRepo } from "./usageRepo";

/** 로그인이 없는 1인 서비스이므로 소유자는 고정값 */
export const SINGLE_OWNER_ID = "me";

type TripRow = Prisma.TripGetPayload<object>;

function toSummary(t: TripRow): TripSummary {
  return {
    id: t.id,
    cityName: t.cityName,
    countryCode: t.countryCode,
    cityId: t.cityId,
    days: t.days,
    startDate: t.startDate?.toISOString() ?? null,
    style: t.style,
    transport: t.transport,
    budget: (t.budget as Budget | null) ?? null,
    status: t.status as TripStatus,
    progress: t.progress,
    createdAt: t.createdAt.toISOString(),
  };
}

export type CreateTripResult =
  | { ok: true; trip: TripSummary }
  | { ok: false; reason: "DAILY_LIMIT_EXCEEDED"; usedToday: number; limit: number };

export function createTripRepo(db: () => Db) {
  const usage = createUsageRepo(db);

  return {
    /**
     * 하루 생성 한도를 확인하고 여행을 만든다. 한도 확인·생성·사용량 기록을 한 직렬화 트랜잭션으로 묶어
     * 동시 요청이 한도를 넘지 못하게 한다.
     */
    async createWithDailyLimit(
      input: CreateTripRequest,
      { limit, now = new Date() }: { limit: number; now?: Date },
    ): Promise<CreateTripResult> {
      const dateKey = seoulDateKey(now);
      return db().$transaction(
        async (tx) => {
          const usedToday = await usage.countTripCreations(dateKey, tx);
          if (isDailyLimitExceeded(usedToday, limit)) {
            return { ok: false, reason: "DAILY_LIMIT_EXCEEDED", usedToday, limit } as const;
          }
          const trip = await tx.trip.create({
            data: {
              ownerId: SINGLE_OWNER_ID,
              cityName: input.city,
              countryCode: input.countryCode ?? null,
              days: input.days,
              startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : null,
              style: input.style,
              transport: input.transport,
              budget: input.budget ?? null,
              status: "queued",
              progress: 0,
              step: "queued",
              stepMessage: "대기 중",
              createdAt: now,
            },
          });
          await usage.record({ provider: "trip", tripId: trip.id, at: now }, tx);
          return { ok: true, trip: toSummary(trip) } as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },

    /** 최신순 목록. cursor는 이전 페이지 마지막 항목의 id */
    async list({ limit, cursor }: { limit: number; cursor?: string }) {
      const rows = await db().trip.findMany({
        where: { ownerId: SINGLE_OWNER_ID },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(toSummary);
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    },

    async getDetail(id: string): Promise<TripDetail | null> {
      const t = await db().trip.findUnique({
        where: { id },
        include: {
          city: true,
          tripDays: { orderBy: { dayIndex: "asc" } },
          nearby: { orderBy: { travelMins: "asc" } },
        },
      });
      if (!t) return null;
      return {
        ...toSummary(t),
        step: (t.step as AgentStep | null) ?? null,
        stepMessage: t.stepMessage,
        errorMessage: t.errorMessage,
        meta: parseJsonColumnAs(TripMetaSchema, t.meta, "Trip.meta"),
        city: t.city
          ? { id: t.city.id, name: t.city.name, countryCode: t.city.countryCode, lat: t.city.lat, lon: t.city.lon }
          : null,
        itinerary: t.tripDays.flatMap((d) => {
          const plan = parseJsonColumnAs(DayPlanSchema, d.stops, `TripDay(${d.dayIndex}).stops`);
          if (!plan) return [];
          return [{ dayIndex: d.dayIndex, title: d.title, stops: plan, routeGeo: parseJsonColumnAs(GeoLineStringSchema, d.routeGeo, "TripDay.routeGeo") }];
        }),
        nearbyTowns: t.nearby.map((n) => ({ name: n.name, travelMins: n.travelMins, reason: n.reason })),
      };
    },

    async getProgress(id: string): Promise<ProgressEvent | null> {
      const t = await db().trip.findUnique({
        where: { id },
        select: { id: true, status: true, step: true, stepMessage: true, progress: true, errorMessage: true },
      });
      return t
        ? {
            tripId: t.id,
            status: t.status as TripStatus,
            step: (t.step as AgentStep | null) ?? (t.status as AgentStep),
            message: t.stepMessage ?? "",
            progress: t.progress,
            errorMessage: t.errorMessage,
          }
        : null;
    },

    /**
     * 진행 상황 기록 (에이전트 저장소도 이것을 쓴다). 진행률은 0~100으로 보정하고 메시지는 컬럼 길이에 맞춘다.
     * 여행이 이미 삭제됐으면 아무것도 하지 않는다 (updateMany — 없는 행에 예외를 던지지 않음).
     */
    async updateProgress(
      id: string,
      update: { status: TripStatus; progress: number; step?: AgentStep; message?: string; errorMessage?: string | null },
    ): Promise<void> {
      await db().trip.updateMany({
        where: { id },
        data: {
          status: update.status,
          progress: Math.max(0, Math.min(100, Math.round(update.progress))),
          ...(update.step ? { step: update.step } : {}),
          ...(update.message !== undefined ? { stepMessage: update.message.slice(0, 500) } : {}),
          errorMessage: update.errorMessage ?? null,
        },
      });
    },

    /**
     * 일자 재생성 시작을 원자적으로 표시한다 (done → running).
     * 이미 작업 중이면 busy, 생성에 실패한 여행(일정 없음)이면 failed, 범위를 벗어난 일자면 badDay.
     */
    async claimForRegeneration(id: string, dayIndex: number): Promise<"ok" | "notFound" | "busy" | "failed" | "badDay"> {
      const t = await db().trip.findUnique({ where: { id }, select: { days: true, status: true } });
      if (!t) return "notFound";
      if (dayIndex >= t.days) return "badDay";
      if (t.status === "failed") return "failed";
      const { count } = await db().trip.updateMany({
        where: { id, status: "done" },
        data: { status: "running", step: "assign", stepMessage: `day ${dayIndex + 1} 재생성 대기`, progress: 0, errorMessage: null },
      });
      return count ? "ok" : "busy";
    },

    /** cutoff 이전부터 갱신이 없는 queued/running 작업을 failed로 정리 */
    async failStale(cutoff: Date): Promise<number> {
      const { count } = await db().trip.updateMany({
        where: { status: { in: ["queued", "running"] }, updatedAt: { lt: cutoff } },
        data: {
          status: "failed",
          step: "failed",
          stepMessage: "중단됨",
          errorMessage: "서버 재시작 등으로 작업이 중단되었습니다. 다시 생성하세요.",
        },
      });
      return count;
    },

    /** @returns 삭제했으면 true, 없으면 false. TripDay·NearbyTown은 FK cascade로 함께 삭제된다. */
    async delete(id: string): Promise<boolean> {
      const { count } = await db().trip.deleteMany({ where: { id } });
      return count > 0;
    },
  };
}

export type TripRepo = ReturnType<typeof createTripRepo>;
export const tripRepo = createTripRepo(getPrisma);
