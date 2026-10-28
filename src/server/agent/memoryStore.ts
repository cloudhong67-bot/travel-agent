import { randomUUID } from "node:crypto";
import type { CreateTripRequest } from "@/lib/schemas";
import type { AgentStore, CityData, DayPlan, NearbyTown, ProgressUpdate, TripInput, TripMeta, UsageRecord } from "./types";

interface MemoryTrip extends TripInput {
  progress: number;
  step: string | null;
  stepMessage: string | null;
  errorMessage: string | null;
  meta: TripMeta | null;
}

/**
 * 메모리 AgentStore — DB 없이 에이전트 전체 흐름을 돌리는 테스트·평가(scripts/eval.ts)용.
 * 저장 시 JSON 왕복으로 복사해 DB 저장과 같은 직렬화 특성을 갖게 한다.
 */
export class MemoryAgentStore implements AgentStore {
  readonly trips = new Map<string, MemoryTrip>();
  readonly cities = new Map<string, CityData>();
  readonly days = new Map<string, Map<number, DayPlan>>();
  readonly nearby = new Map<string, NearbyTown[]>();
  readonly usage: (UsageRecord & { tripId: string })[] = [];
  /** 진행 이벤트 기록 (테스트에서 단계 순서 확인용) */
  readonly progressLog: (ProgressUpdate & { tripId: string })[] = [];

  createTrip(input: CreateTripRequest): string {
    const id = randomUUID();
    this.trips.set(id, {
      id,
      cityName: input.city,
      countryCode: input.countryCode ?? null,
      days: input.days,
      autoDays: input.autoDays ?? false,
      startDate: input.startDate ?? null,
      style: input.style,
      transport: input.transport,
      budget: input.budget ?? null,
      status: "queued",
      cityId: null,
      progress: 0,
      step: "queued",
      stepMessage: null,
      errorMessage: null,
      meta: null,
    });
    return id;
  }

  async getTrip(tripId: string) {
    const t = this.trips.get(tripId);
    return t ? { ...t } : null;
  }

  async updateProgress(tripId: string, u: ProgressUpdate) {
    const t = this.trips.get(tripId);
    if (!t) return;
    Object.assign(t, { status: u.status, progress: u.progress, step: u.step, stepMessage: u.message, errorMessage: u.errorMessage ?? null });
    this.progressLog.push({ tripId, ...u });
  }

  async findFreshCity(name: string, countryCode: string, maxAgeDays: number, now: Date) {
    const since = now.getTime() - maxAgeDays * 86_400_000;
    const c = [...this.cities.values()].find((c) => c.name === name && c.countryCode === countryCode && c.refreshedAt.getTime() >= since);
    return c ? clone(c) : null;
  }

  async getCity(cityId: string) {
    const c = this.cities.get(cityId);
    return c ? clone(c) : null;
  }

  async saveCity(city: Omit<CityData, "id">) {
    const existing = [...this.cities.values()].find((c) => c.name === city.name && c.countryCode === city.countryCode);
    const saved: CityData = {
      ...clone(city),
      id: existing?.id ?? randomUUID(),
      refreshedAt: city.refreshedAt,
      pois: city.pois.map((p) => ({ ...p, id: randomUUID() })),
    };
    this.cities.set(saved.id, saved);
    return clone(saved);
  }

  async linkCity(tripId: string, cityId: string) {
    const t = this.trips.get(tripId);
    if (t) t.cityId = cityId;
  }

  async getDays(tripId: string) {
    return [...(this.days.get(tripId)?.values() ?? [])].map(clone).sort((a, b) => a.dayIndex - b.dayIndex);
  }

  async saveDays(tripId: string, days: DayPlan[]) {
    const map = this.days.get(tripId) ?? new Map();
    for (const d of days) map.set(d.dayIndex, clone(d));
    this.days.set(tripId, map);
  }

  async replaceDays(tripId: string, days: DayPlan[]) {
    this.days.set(tripId, new Map(days.map((d) => [d.dayIndex, clone(d)])));
  }

  async updateSchedule(tripId: string, schedule: { days: number; startDate?: string | null }) {
    const t = this.trips.get(tripId);
    if (!t) return;
    t.days = schedule.days;
    if (schedule.startDate !== undefined) t.startDate = schedule.startDate;
  }

  async getNearby(tripId: string) {
    return clone(this.nearby.get(tripId) ?? []);
  }

  async saveNearby(tripId: string, towns: NearbyTown[]) {
    this.nearby.set(tripId, clone(towns));
  }

  async getMeta(tripId: string) {
    const m = this.trips.get(tripId)?.meta;
    return m ? clone(m) : null;
  }

  async finish(tripId: string, r: { status: "done" | "failed"; meta: TripMeta; errorMessage: string | null; message: string }) {
    const t = this.trips.get(tripId);
    if (!t) return;
    Object.assign(t, {
      status: r.status,
      progress: 100,
      step: r.status,
      stepMessage: r.message,
      errorMessage: r.errorMessage,
      meta: clone(r.meta),
    });
    this.progressLog.push({ tripId, status: r.status, step: r.status, message: r.message, progress: 100, errorMessage: r.errorMessage });
  }

  async recordUsage(tripId: string, records: UsageRecord[]) {
    this.usage.push(...records.map((r) => ({ ...r, tripId })));
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (key, v) => (key === "refreshedAt" && typeof v === "string" ? new Date(v) : v));
}
