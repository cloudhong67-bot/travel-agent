import { randomUUID } from "node:crypto";
import type { TripStatus } from "@/lib/schemas";
import type {
  AgentPoi,
  AgentStore,
  CityBackground,
  CityData,
  DayPlan,
  NearbyTown,
  PoiCategory,
  TourismInfo,
  TripInput,
  TripMeta,
} from "@/server/agent/types";
import { seoulDateKey, toDbDate } from "@/server/limits";
import { getPrisma, type Db } from "./client";
import { parseJsonColumn } from "./json";
import { createTripRepo } from "./tripRepo";

type CityRow = NonNullable<Awaited<ReturnType<Db["city"]["findUnique"]>>> & {
  pois: NonNullable<Awaited<ReturnType<Db["poi"]["findUnique"]>>>[];
};

function toCityData(c: CityRow): CityData {
  return {
    id: c.id,
    name: c.name,
    countryCode: c.countryCode,
    lat: c.lat,
    lon: c.lon,
    background: parseJsonColumn(c.background) as CityBackground | null,
    tourismBoard: parseJsonColumn(c.tourismBoard) as TourismInfo | null,
    refreshedAt: c.refreshedAt,
    pois: c.pois.map(
      (p): AgentPoi => ({
        key: "",
        id: p.id,
        name: p.name,
        category: p.category as PoiCategory,
        lat: p.lat,
        lon: p.lon,
        hours: parseJsonColumn(p.hours) as string[] | null,
        sourceUrl: p.sourceUrl,
        origin: c.countryCode === "KR" ? "naver" : "google",
      }),
    ),
  };
}

const kindLabel = (t: NearbyTown) => (t.kind === "dayTrip" ? "[당일치기]" : "[1박 추천]");

/** 에이전트용 Prisma 저장소. TripDay.stops에는 DayPlan(경로선 제외)을 JSON으로, 근교 도시 좌표 등은 Trip.meta에 둔다 */
export function createAgentStore(db: () => Db): AgentStore {
  const trips = createTripRepo(db);
  const getMetaRaw = async (tripId: string) => {
    const t = await db().trip.findUnique({ where: { id: tripId }, select: { meta: true } });
    return (parseJsonColumn(t?.meta ?? null) as (TripMeta & { nearbyTowns?: NearbyTown[] }) | null) ?? null;
  };

  return {
    async getTrip(tripId): Promise<TripInput | null> {
      const t = await db().trip.findUnique({ where: { id: tripId } });
      if (!t) return null;
      return {
        id: t.id,
        cityName: t.cityName,
        countryCode: t.countryCode,
        days: t.days,
        startDate: t.startDate?.toISOString().slice(0, 10) ?? null,
        style: t.style,
        transport: t.transport as TripInput["transport"],
        budget: (t.budget as TripInput["budget"]) ?? null,
        status: t.status as TripStatus,
        cityId: t.cityId,
      };
    },

    updateProgress: (tripId, u) => trips.updateProgress(tripId, u),

    async findFreshCity(name, countryCode, maxAgeDays, now) {
      const since = new Date(now.getTime() - maxAgeDays * 86_400_000);
      const c = await db().city.findFirst({
        where: { name, countryCode, refreshedAt: { gte: since } },
        include: { pois: true },
      });
      return c ? toCityData(c) : null;
    },

    async getCity(cityId) {
      const c = await db().city.findUnique({ where: { id: cityId }, include: { pois: true } });
      return c ? toCityData(c) : null;
    },

    async saveCity(city) {
      const data = {
        lat: city.lat,
        lon: city.lon,
        background: city.background ? JSON.stringify(city.background) : null,
        tourismBoard: city.tourismBoard ? JSON.stringify(city.tourismBoard) : null,
        refreshedAt: city.refreshedAt,
      };
      const pois = city.pois.map((p) => ({ ...p, id: randomUUID() }));
      const id = await db().$transaction(async (tx) => {
        const saved = await tx.city.upsert({
          where: { name_countryCode: { name: city.name, countryCode: city.countryCode } },
          create: { name: city.name, countryCode: city.countryCode, ...data },
          update: data,
          select: { id: true },
        });
        await tx.poi.deleteMany({ where: { cityId: saved.id } });
        if (pois.length) {
          await tx.poi.createMany({
            data: pois.map((p) => ({
              id: p.id,
              cityId: saved.id,
              name: p.name.slice(0, 500),
              category: p.category,
              lat: p.lat,
              lon: p.lon,
              hours: p.hours ? JSON.stringify(p.hours) : null,
              sourceUrl: p.sourceUrl?.slice(0, 1000) ?? null,
            })),
          });
        }
        return saved.id;
      });
      return { ...city, id, pois };
    },

    async linkCity(tripId, cityId) {
      await db().trip.updateMany({ where: { id: tripId }, data: { cityId } });
    },

    async getDays(tripId) {
      const rows = await db().tripDay.findMany({ where: { tripId }, orderBy: { dayIndex: "asc" } });
      return rows.map((r) => ({
        ...(parseJsonColumn(r.stops) as Omit<DayPlan, "routeGeo">),
        dayIndex: r.dayIndex,
        title: r.title,
        routeGeo: parseJsonColumn(r.routeGeo) as DayPlan["routeGeo"],
      }));
    },

    async saveDays(tripId, days) {
      await db().$transaction(async (tx) => {
        await tx.tripDay.deleteMany({ where: { tripId, dayIndex: { in: days.map((d) => d.dayIndex) } } });
        await tx.tripDay.createMany({
          data: days.map(({ routeGeo, ...plan }) => ({
            tripId,
            dayIndex: plan.dayIndex,
            title: plan.title.slice(0, 500),
            stops: JSON.stringify(plan),
            routeGeo: routeGeo ? JSON.stringify(routeGeo) : null,
          })),
        });
      });
    },

    async getNearby(tripId) {
      return (await getMetaRaw(tripId))?.nearbyTowns ?? [];
    },

    async saveNearby(tripId, towns) {
      await db().$transaction(async (tx) => {
        await tx.nearbyTown.deleteMany({ where: { tripId } });
        if (towns.length) {
          await tx.nearbyTown.createMany({
            data: towns.map((t) => ({ tripId, name: t.name, travelMins: t.travelMins, reason: `${kindLabel(t)} ${t.reason}`.slice(0, 1000) })),
          });
        }
        // 좌표·구분은 일자 재생성에 필요하므로 meta에도 보관
        const row = await tx.trip.findUnique({ where: { id: tripId }, select: { meta: true } });
        const meta = (parseJsonColumn(row?.meta ?? null) as Record<string, unknown> | null) ?? {};
        await tx.trip.update({ where: { id: tripId }, data: { meta: JSON.stringify({ ...meta, nearbyTowns: towns }) } });
      });
    },

    async getMeta(tripId) {
      return getMetaRaw(tripId);
    },

    async finish(tripId, r) {
      const prev = await getMetaRaw(tripId);
      await db().trip.updateMany({
        where: { id: tripId },
        data: {
          status: r.status,
          progress: 100,
          step: r.status,
          stepMessage: r.message.slice(0, 500),
          errorMessage: r.errorMessage,
          meta: JSON.stringify({ ...r.meta, nearbyTowns: prev?.nearbyTowns ?? [] }),
        },
      });
    },

    async recordUsage(tripId, records) {
      const date = toDbDate(seoulDateKey());
      await db().usageLog.createMany({
        data: records.map((r) => ({ date, tripId, provider: r.provider, calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens })),
      });
    },
  };
}

export const agentStore = createAgentStore(getPrisma);
