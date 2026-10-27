import { z } from "zod";
import { CityBackgroundSchema, TourismInfoSchema, type CityDetail } from "@/lib/schemas";
import { getPrisma, type Db } from "./client";
import { parseJsonColumnAs } from "./json";

const HoursSchema = z.array(z.string());

export interface UpsertCityInput {
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
  background?: unknown;
  tourismBoard?: unknown;
}

const toJson = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));

export function createCityRepo(db: () => Db) {
  return {
    async getDetail(id: string): Promise<CityDetail | null> {
      const c = await db().city.findUnique({
        where: { id },
        include: { pois: { orderBy: { name: "asc" } } },
      });
      if (!c) return null;
      return {
        id: c.id,
        name: c.name,
        countryCode: c.countryCode,
        lat: c.lat,
        lon: c.lon,
        background: parseJsonColumnAs(CityBackgroundSchema, c.background, "City.background"),
        tourismBoard: parseJsonColumnAs(TourismInfoSchema, c.tourismBoard, "City.tourismBoard"),
        refreshedAt: c.refreshedAt.toISOString(),
        pois: c.pois.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          lat: p.lat,
          lon: p.lon,
          hours: parseJsonColumnAs(HoursSchema, p.hours, "Poi.hours"),
          sourceUrl: p.sourceUrl,
        })),
      };
    },

    /** (name, countryCode) 기준 upsert. 캐시 갱신 시각(refreshedAt)을 now로 바꾼다. */
    async upsert(input: UpsertCityInput, now: Date = new Date()): Promise<string> {
      const data = {
        lat: input.lat,
        lon: input.lon,
        background: toJson(input.background),
        tourismBoard: toJson(input.tourismBoard),
        refreshedAt: now,
      };
      const city = await db().city.upsert({
        where: { name_countryCode: { name: input.name, countryCode: input.countryCode } },
        create: { name: input.name, countryCode: input.countryCode, ...data },
        update: data,
        select: { id: true },
      });
      return city.id;
    },

    /** 캐시 확인용(PRD 7장 2단계): maxAgeDays 이내에 갱신된 도시면 id 반환 */
    async findFresh(name: string, countryCode: string, maxAgeDays = 30, now: Date = new Date()) {
      const since = new Date(now.getTime() - maxAgeDays * 86_400_000);
      const c = await db().city.findFirst({
        where: { name, countryCode, refreshedAt: { gte: since } },
        select: { id: true },
      });
      return c?.id ?? null;
    },
  };
}

export type CityRepo = ReturnType<typeof createCityRepo>;
export const cityRepo = createCityRepo(getPrisma);
