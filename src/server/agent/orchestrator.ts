/**
 * 에이전트 오케스트레이터 — PRD 7장 파이프라인
 *   1 입력 정규화 → 2 캐시 확인 → 3 병렬 수집 → 4 일자 배분(LLM) → 5 동선 최적화(코드) → 6 검증(+재시도) → 7 저장
 * 여기에는 파이프라인 순서만 둔다. 진행 기록·사용량·완료/실패 처리는 job.ts(AgentJob)가 맡는다.
 * 상태의 기준은 DB이므로 어느 복제본이 작업을 돌려도 SSE로 구독할 수 있다.
 */
import { weekdayFromKo } from "@/lib/hours";
import { withSpan } from "@/server/telemetry";
import type { GeocodeResult, MapsProvider, TravelMode } from "@/server/adapters/maps/types";
import { assignDays, fallbackAssignment, type AssignResult, type DayAssignment } from "./assign";
import { BudgetExceededError } from "./budget";
import { collectHistory, collectNearbyTowns, collectTourism, lookupRecommended, mergePois, searchCityPois } from "./collect";
import { AgentError, AgentJob } from "./job";
import { planDay, tripMode } from "./plan";
import { assignKeys } from "./poiUtils";
import { countryNameKo } from "./prompts/common";
import {
  CITY_CACHE_DAYS,
  type AgentDeps,
  type AgentPoi,
  type CityBackground,
  type CityData,
  type DayPlan,
  type NearbyTown,
  type TourismInfo,
  type TripInput,
} from "./types";
import { issuesToFeedback, validateDay } from "./validator";

export { AgentError } from "./job";

export const MAX_VALIDATION_RETRIES = 2;
export const KR_TRAVEL_NOTICE = "국내 도시는 대중교통 경로 데이터가 없어 이동시간을 자동차 기준으로 계산했습니다.";
export const ASSIGN_FALLBACK_WARNING = "AI 일정 배분에 실패해 거리 기준 자동 배분으로 대신했습니다. 결과를 확인하세요.";

// ---------- 1. 입력 정규화 ----------

function pickGeocode(results: GeocodeResult[], trip: TripInput, warnings: string[]): GeocodeResult {
  const candidates = trip.countryCode ? results.filter((r) => r.countryCode === trip.countryCode) : results;
  const hit = candidates[0];
  if (!hit?.countryCode) {
    throw new AgentError(
      trip.countryCode
        ? `'${trip.cityName}'을(를) ${trip.countryCode}에서 찾지 못했습니다. 도시명이나 국가를 확인하세요.`
        : `'${trip.cityName}'을(를) 찾지 못했습니다. 도시명을 확인하세요.`,
    );
  }
  const countries = new Set(results.map((r) => r.countryCode).filter(Boolean));
  if (!trip.countryCode && countries.size > 1) {
    warnings.push(
      `'${trip.cityName}'은(는) 여러 나라(${[...countries].join(", ")})에 있어 ${hit.countryCode}의 ${hit.name}(으)로 선택했습니다. 국가를 지정하면 정확해집니다.`,
    );
  }
  return hit;
}

// ---------- 3. 병렬 수집 ----------

interface Collected {
  city: CityData;
  nearby: NearbyTown[];
  /** 수집 중 비용 상한에 걸렸으면 그 오류. 수집한 것은 저장한 뒤 호출 측이 부분 결과로 끝낸다 */
  budgetError: BudgetExceededError | null;
}

interface CollectContext {
  job: AgentJob;
  deps: AgentDeps;
  trip: TripInput;
  geo: GeocodeResult;
  maps: MapsProvider;
  mode: TravelMode;
}

/** 3개(캐시 시 0개) 수집 + 근교 도시를 동시에 돌리고, 각각의 실패는 경고로 바꿔 나머지로 진행한다 */
async function collectAll(ctx: CollectContext, cached: CityData | null): Promise<Collected> {
  const { job, deps, trip, geo, maps, mode } = ctx;
  const countryCode = geo.countryCode!;
  const countryName = countryNameKo(countryCode);
  const center = geo.location;
  const isKr = countryCode === "KR";

  let done = 0;
  const total = (cached ? 0 : 3) + (isKr ? 0 : 1);
  const tracked = async <T>(label: string, p: Promise<T>): Promise<T> => {
    try {
      return await p;
    } finally {
      done++;
      await job.progress("collect", `${label} 완료 (${done}/${total})`, done / (total + 1));
    }
  };

  await job.progress("collect", cached ? "저장된 도시 정보를 사용하고 근교 도시를 찾는 중" : "역사·관광청·명소·근교 도시를 동시에 조사하는 중");

  const [history, tourism, searched, nearby] = await Promise.allSettled([
    cached ? Promise.resolve(cached.background) : tracked("역사·배경 조사", collectHistory(job.llm, deps.wiki, trip.cityName, geo.name)),
    cached ? Promise.resolve(cached.tourismBoard) : tracked("관광청 조사", collectTourism(job.search, countryName, geo.name, countryCode)),
    cached ? Promise.resolve(cached.pois) : tracked("명소 검색", searchCityPois(maps, center, geo.name)),
    isKr
      ? Promise.resolve({ towns: [] as NearbyTown[], warnings: [] as string[] })
      : tracked(
          "근교 도시 조사",
          collectNearbyTowns({ llm: job.llm, geocoder: job.geocoder, maps, base: center, cityName: geo.name, countryName, style: trip.style, mode }),
        ),
  ]);

  let budgetError: BudgetExceededError | null = null;
  const value = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    if (r.reason instanceof BudgetExceededError) {
      budgetError ??= r.reason;
    } else {
      console.error(`[agent] ${label} 실패`, r.reason);
      job.meta.warnings.push(`${label}에 실패해 해당 정보 없이 진행했습니다.`);
    }
    return null;
  };

  const background = value(history, "역사·배경 조사") as CityBackground | null;
  const tourismInfo = value(tourism, "관광청 조사") as TourismInfo | null;
  const searchedPois = (value(searched, "명소 검색") as AgentPoi[] | null) ?? [];
  const nearbyResult = value(nearby, "근교 도시 조사");
  if (nearbyResult) job.meta.warnings.push(...nearbyResult.warnings);
  if (isKr) job.meta.notices.push("국내 도시는 근교 소도시 추천을 제공하지 않습니다.");

  let city: CityData;
  if (cached) {
    city = cached;
  } else {
    // 관광청 추천 명소를 지도에서 찾아 POI와 병합 (이름·좌표 100m 중복 제거)
    let recommended: AgentPoi[] = [];
    if (tourismInfo?.recommended.length && !budgetError) {
      recommended = await lookupRecommended(maps, center, geo.name, tourismInfo.recommended).catch((e) => {
        if (e instanceof BudgetExceededError) budgetError ??= e;
        else console.error("[agent] 관광청 추천 명소 조회 실패", e);
        return [];
      });
    }
    const pois = mergePois(recommended, searchedPois);
    // 수집이 일부 실패한 도시는 캐시로 쓰지 않도록 즉시 만료된 시각으로 저장한다 (다음 요청에서 다시 수집)
    const complete = background !== null && tourismInfo !== null && pois.length > 0;
    city = await job.store.saveCity({
      name: geo.name,
      countryCode,
      lat: center.lat,
      lon: center.lng,
      background,
      tourismBoard: tourismInfo,
      pois,
      refreshedAt: complete ? job.now : new Date(job.now.getTime() - (CITY_CACHE_DAYS + 1) * 86_400_000),
    });
  }
  await job.store.linkCity(job.tripId, city.id);

  return { city: { ...city, pois: assignKeys(city.pois) }, nearby: nearbyResult?.towns ?? [], budgetError };
}

// ---------- 4~6. 배분 → 최적화 → 검증(재시도) ----------

interface PlanContext {
  job: AgentJob;
  trip: TripInput;
  city: CityData;
  maps: MapsProvider;
  mode: TravelMode;
  nearby: NearbyTown[];
  base: { name: string; lat: number; lon: number };
  /** 진행 중 만들어진 일자 (예산 초과 시 부분 저장용) */
  plans: Map<number, DayPlan>;
}

type AssignArgs = Parameters<typeof assignDays>[0];

/**
 * 최초 배분: LLM이 실패하면(장애·할당량·형식 오류) 거리 기준 대체 배분으로 일정을 이어서 만든다.
 * 비용 상한 초과는 부분 저장으로 가야 하므로 그대로 던진다.
 */
async function assignWithFallback(job: AgentJob, args: AssignArgs): Promise<AssignResult> {
  try {
    return await assignDays(args);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    console.error(`[agent] trip ${job.tripId} LLM 배분 실패 — 대체 배분 사용`, error);
    job.meta.warnings.push(ASSIGN_FALLBACK_WARNING);
    return fallbackAssignment(args);
  }
}

async function planDays(ctx: PlanContext, assignments: Map<number, DayAssignment>, attempt: number) {
  const entries = [...assignments.values()].sort((a, b) => a.dayIndex - b.dayIndex);
  for (const [i, assignment] of entries.entries()) {
    // 재시도 중에는 진행률이 뒤로 가지 않도록 검증 단계 안에서 보고한다
    if (attempt === 1) await ctx.job.progress("optimize", `day ${assignment.dayIndex + 1} 동선 계산 중`, i / entries.length);
    else await ctx.job.progress("validate", `day ${assignment.dayIndex + 1} 동선 재계산 중 (재시도 ${attempt - 1})`, (attempt - 1) / (MAX_VALIDATION_RETRIES + 1));
    const plan = await planDay({
      maps: ctx.maps,
      assignment,
      base: ctx.base,
      mode: ctx.mode,
      startDate: ctx.trip.startDate,
      nearbyTowns: ctx.nearby,
      warnings: ctx.job.meta.warnings,
    });
    plan.attempts = attempt;
    ctx.plans.set(plan.dayIndex, plan);
  }
}

function applyValidation(plan: DayPlan): DayPlan {
  const weekday = weekdayFromKo(plan.weekday);
  const issues = validateDay({ ...plan, weekday: weekday < 0 ? null : weekday });
  plan.validation = { passed: issues.length === 0, issues };
  return plan;
}

/** 배분·최적화·검증. 실패한 날만 최대 2회 다시 배분·최적화하고, 그래도 실패하면 "검증 필요"로 표시 */
async function buildItinerary(ctx: PlanContext, dayIndexes: number[], extraFeedback?: string) {
  const { job, trip, city } = ctx;
  const others = [...ctx.plans.values()].filter((p) => !dayIndexes.includes(p.dayIndex));
  const usedElsewhere = new Set(others.flatMap((p) => p.stops.map((s) => s.key)));
  // 재생성 시 다른 일자의 당일치기 도시를 다시 배정하지 않도록 뺀다
  const townsElsewhere = new Set(others.map((p) => p.dayTripTown));
  const available = (exclude: Set<string>) => city.pois.filter((p) => !exclude.has(p.key));

  await job.progress("assign", `${dayIndexes.length}일 일정을 배분하는 중`);
  const first = await assignWithFallback(job, {
    llm: job.llm,
    trip,
    cityName: city.name,
    dayIndexes,
    pois: available(usedElsewhere),
    nearbyTowns: ctx.nearby.filter((t) => !townsElsewhere.has(t.name)),
    feedback: extraFeedback,
  });
  job.meta.warnings.push(...first.warnings);
  await job.progress("assign", "일자 배분 완료", 1);
  await job.flushUsage();

  await planDays(ctx, first.days, 1);
  await job.progress("optimize", "동선 계산 완료", 1);
  await job.flushUsage();

  await job.progress("validate", "일정을 검증하는 중");
  for (const i of dayIndexes) applyValidation(ctx.plans.get(i)!);

  for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    const failing = dayIndexes.filter((i) => !ctx.plans.get(i)!.validation.passed);
    if (failing.length === 0) break;
    await job.progress("validate", `검증 실패 ${failing.length}일 재배치 중 (${attempt}/${MAX_VALIDATION_RETRIES})`, attempt / (MAX_VALIDATION_RETRIES + 1));

    const keep = new Set([...usedElsewhere, ...dayIndexes.filter((i) => !failing.includes(i)).flatMap((i) => ctx.plans.get(i)!.stops.map((s) => s.key))]);
    const feedback = failing.map((i) => `day ${i}:\n${issuesToFeedback(ctx.plans.get(i)!.validation.issues)}`).join("\n");
    let retry: AssignResult;
    try {
      retry = await assignDays({
        llm: job.llm,
        trip,
        cityName: city.name,
        dayIndexes: failing,
        pois: available(keep),
        nearbyTowns: ctx.nearby.filter((t) => ![...ctx.plans.values()].some((p) => p.dayTripTown === t.name && !failing.includes(p.dayIndex))),
        feedback,
      });
    } catch (error) {
      // 재시도는 개선 시도일 뿐이므로, LLM이 실패하면 지금 일정을 "검증 필요"로 남기고 끝낸다
      if (error instanceof BudgetExceededError) throw error;
      console.error(`[agent] trip ${job.tripId} 검증 재시도 배분 실패 — 현재 일정 유지`, error);
      job.meta.warnings.push("검증 실패 일자를 다시 배분하지 못해 현재 일정을 유지했습니다.");
      break;
    }
    job.meta.warnings.push(...retry.warnings);
    await planDays(ctx, retry.days, attempt + 1);
    for (const i of failing) applyValidation(ctx.plans.get(i)!);
    await job.flushUsage();
  }

  for (const i of dayIndexes) {
    const plan = ctx.plans.get(i)!;
    plan.needsReview = !plan.validation.passed;
  }
  await job.progress("validate", "검증 완료", 1);
}

// ---------- 공개 API ----------

/** 여행 1건 전체 생성. 예외를 밖으로 던지지 않는다 (결과는 DB 상태로 확인) */
export function runTripJob(tripId: string, deps: AgentDeps): Promise<void> {
  // 루트 span 아래에 단계 span(agent.step.*)과 외부 호출 span(external.*)이 붙는다
  return withSpan("agent.runTripJob", { "trippilot.trip_id": tripId }, () => runTripJobInner(tripId, deps));
}

async function runTripJobInner(tripId: string, deps: AgentDeps): Promise<void> {
  const job = new AgentJob(tripId, deps);
  const plans = new Map<number, DayPlan>();
  let nearby: NearbyTown[] = [];
  try {
    const trip = await deps.store.getTrip(tripId);
    if (!trip) return; // 삭제됨

    // 1. 입력 정규화 (PRD: 항상 Google Geocoding으로 국가코드 확정)
    await job.progress("normalize", `'${trip.cityName}' 위치를 확인하는 중`);
    const geo = pickGeocode(await job.geocoder.geocode(trip.cityName, { language: "ko" }), trip, job.meta.warnings);
    const countryCode = geo.countryCode!;
    const base = { name: `${geo.name} 중심 (숙소 거점)`, lat: geo.location.lat, lon: geo.location.lng };
    const maps = job.mapsFor(countryCode);
    const mode = tripMode(trip.transport, countryCode);
    Object.assign(job.meta, { base, countryCode });
    if (countryCode === "KR") job.meta.travelBasisNotice = KR_TRAVEL_NOTICE;
    await job.progress("normalize", `${geo.formattedAddress} (${countryCode}) 확인`, 1);

    // 2. 캐시 확인
    await job.progress("cache", "저장된 도시 정보를 확인하는 중");
    const cached = await deps.store.findFreshCity(geo.name, countryCode, CITY_CACHE_DAYS, job.now);
    job.meta.cache = { hit: Boolean(cached), cityRefreshedAt: cached?.refreshedAt.toISOString() ?? null };
    await job.progress("cache", cached ? "30일 이내 수집한 도시 정보를 재사용합니다" : "새로 수집합니다", 1);

    // 3. 병렬 수집
    const collected = await collectAll({ job, deps, trip, geo, maps, mode }, cached);
    nearby = collected.nearby;
    if (collected.budgetError) throw collected.budgetError;
    await job.flushUsage();
    if (collected.city.pois.length === 0) throw new AgentError("방문할 명소를 찾지 못했습니다.");
    if (job.meta.travelBasisNotice === null && mode === "transit") {
      job.meta.notices.push("대중교통 이동시간은 지도 API 기준이며, 데이터가 없는 구간은 자동차 시간으로 대체했습니다.");
    }

    // 4~6. 배분 → 최적화 → 검증
    const ctx: PlanContext = { job, trip, city: collected.city, maps, mode, nearby, base, plans };
    await buildItinerary(ctx, Array.from({ length: trip.days }, (_, i) => i));

    // 7. 저장
    await job.progress("save", "결과를 저장하는 중");
    const reviewCount = [...plans.values()].filter((p) => p.needsReview).length;
    await job.complete(plans, {
      saveDays: [...plans.values()],
      nearby,
      message: reviewCount ? `완료 (검증 필요 ${reviewCount}일)` : "완료",
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) await job.completePartial(plans, nearby, error);
    else await job.fail(error, { fallbackMessage: `일정 생성 중 오류가 발생했습니다 (단계: ${job.currentStep}).` });
  } finally {
    await job.flushUsage();
  }
}

/** 특정 일자만 4~6단계 재실행 (FR-11). 다른 일자에 쓴 POI는 피한다 */
export function runDayRegeneration(tripId: string, dayIndex: number, deps: AgentDeps): Promise<void> {
  return withSpan("agent.regenerateDay", { "trippilot.trip_id": tripId, "trippilot.day_index": dayIndex }, () =>
    runDayRegenerationInner(tripId, dayIndex, deps),
  );
}

async function runDayRegenerationInner(tripId: string, dayIndex: number, deps: AgentDeps): Promise<void> {
  const job = new AgentJob(tripId, deps);
  const plans = new Map<number, DayPlan>();
  let current: DayPlan | undefined;
  try {
    const trip = await deps.store.getTrip(tripId);
    if (!trip) return;
    if (!trip.cityId) throw new AgentError("도시 정보가 없어 재생성할 수 없습니다. 여행을 다시 만드세요.");
    const [city, days, nearby, meta] = await Promise.all([
      deps.store.getCity(trip.cityId),
      deps.store.getDays(tripId),
      deps.store.getNearby(tripId),
      deps.store.getMeta(tripId),
    ]);
    if (!city) throw new AgentError("도시 정보를 찾을 수 없습니다.");
    if (meta) job.meta = { ...meta, partial: false, stepDurationsMs: {} };

    for (const d of days) plans.set(d.dayIndex, d);
    current = plans.get(dayIndex);
    plans.delete(dayIndex);

    const maps = job.mapsFor(city.countryCode);
    const mode = tripMode(trip.transport, city.countryCode);
    const base = job.meta.base ?? { name: `${city.name} 중심 (숙소 거점)`, lat: city.lat, lon: city.lon };
    const pois = assignKeys(city.pois);
    // 저장된 일정은 이전 키로 기록돼 있으므로 POI id 기준으로 새 키에 맞춘다
    const keyById = new Map(pois.map((p) => [p.id, p.key]));
    for (const p of plans.values()) for (const s of p.stops) s.key = (s.poiId && keyById.get(s.poiId)) || s.key;

    const ctx: PlanContext = { job, trip, city: { ...city, pois }, maps, mode, nearby, base, plans };
    const previous = current?.stops.map((s) => s.name).join(", ");
    await buildItinerary(ctx, [dayIndex], previous ? `사용자가 day ${dayIndex} 재생성을 요청했다. 기존 구성(${previous})과 다르게 짜라.` : undefined);

    await job.progress("save", `day ${dayIndex + 1} 저장 중`);
    await job.complete(plans, { saveDays: [plans.get(dayIndex)!], message: `day ${dayIndex + 1} 재생성 완료` });
  } catch (error) {
    // 새 일정을 만들기 전에 실패했다면 기존 일자를 되돌려 needsReviewDays가 DB의 일정과 맞게 한다
    const regenerated = plans.has(dayIndex);
    if (!regenerated && current) plans.set(dayIndex, current);
    if (error instanceof BudgetExceededError) {
      await job.completePartial(plans, [], error, regenerated ? [dayIndex] : []);
    } else {
      // 재생성 실패가 기존 일정까지 실패로 만들지 않도록 done을 유지하고 오류만 남긴다
      await job.fail(error, { plans, keepDone: true, fallbackMessage: `day ${dayIndex + 1} 재생성 중 오류가 발생했습니다.` });
    }
  } finally {
    await job.flushUsage();
  }
}
