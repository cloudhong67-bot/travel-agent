/**
 * 에이전트 오케스트레이터 — PRD 7장 파이프라인
 *   1 입력 정규화 → 2 캐시 확인 → 3 병렬 수집 → 4 일자 배분(LLM) → 5 동선 최적화(코드) → 6 검증(+재시도) → 7 저장
 * 진행 상황은 DB(Trip.step/stepMessage/progress)에 쓰고, SSE 라우트가 이를 읽어 { step, message, progress }로 보낸다.
 * 상태의 기준은 DB이므로 어느 복제본이 작업을 돌려도 구독할 수 있다.
 */
import { SpanStatusCode, type Span } from "@opentelemetry/api";
import type { AgentStep } from "@/lib/schemas";
import { tracer, withSpan } from "@/server/telemetry";
import type { GeocodeResult, MapsProvider, TravelMode } from "@/server/adapters/maps/types";
import { assignDays, type DayAssignment } from "./assign";
import { Budget, BudgetExceededError, meterLlm, meterMaps, meterSearch } from "./budget";
import { collectHistory, collectNearbyTowns, collectTourism, lookupRecommended, mergePois, searchCityPois } from "./collect";
import { planDay, tripMode } from "./plan";
import { assignKeys } from "./poiUtils";
import { countryNameKo } from "./prompts/common";
import {
  CITY_CACHE_DAYS,
  DEFAULT_LIMITS,
  type AgentDeps,
  type AgentPoi,
  type AgentStore,
  type CityBackground,
  type CityData,
  type DayPlan,
  type NearbyTown,
  type SearchProvider,
  type TourismInfo,
  type TripInput,
  type TripMeta,
} from "./types";
import { issuesToFeedback, validateDay } from "./validator";
import type { LlmProvider } from "@/server/adapters/llm/types";

export const MAX_VALIDATION_RETRIES = 2;
export const KR_TRAVEL_NOTICE = "국내 도시는 대중교통 경로 데이터가 없어 이동시간을 자동차 기준으로 계산했습니다.";

/** 사용자에게 그대로 보여줘도 되는 오류 */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

// 단계별 진행률 구간 [시작, 완료]
const STEP_RANGE: Record<Exclude<AgentStep, "queued" | "done" | "failed">, [number, number]> = {
  normalize: [2, 8],
  cache: [10, 12],
  collect: [15, 50],
  assign: [52, 62],
  optimize: [64, 78],
  validate: [80, 90],
  save: [92, 99],
};

interface Job {
  tripId: string;
  store: AgentStore;
  budget: Budget;
  llm: LlmProvider;
  search: SearchProvider;
  geocoder: MapsProvider;
  now: Date;
  meta: TripMeta;
  step: AgentStep;
  stepStartedAt: number;
  /** 현재 단계의 OpenTelemetry span (agent.step.<단계>) */
  stepSpan?: Span;
}

function newMeta(): TripMeta {
  return {
    version: 1,
    base: null,
    countryCode: null,
    travelBasisNotice: null,
    notices: [],
    warnings: [],
    needsReviewDays: [],
    partial: false,
    cache: { hit: false, cityRefreshedAt: null },
    usage: null,
    stepDurationsMs: {},
  };
}

function createJob(tripId: string, deps: AgentDeps): Job {
  const budget = new Budget({ ...DEFAULT_LIMITS, ...deps.limits });
  return {
    tripId,
    store: deps.store,
    budget,
    llm: meterLlm(deps.llm, budget),
    search: meterSearch(deps.search, budget),
    geocoder: meterMaps(deps.geocoder, budget),
    now: deps.now?.() ?? new Date(),
    meta: newMeta(),
    step: "queued",
    stepStartedAt: Date.now(),
  };
}

async function progress(job: Job, step: Exclude<AgentStep, "queued" | "done" | "failed">, message: string, fraction = 0) {
  if (step !== job.step) {
    if (job.step !== "queued") job.meta.stepDurationsMs[job.step] = Date.now() - job.stepStartedAt;
    job.step = step;
    job.stepStartedAt = Date.now();
    job.stepSpan?.end();
    job.stepSpan = tracer.startSpan(`agent.step.${step}`, { attributes: { "trippilot.trip_id": job.tripId } });
  }
  job.stepSpan?.addEvent(message);
  const [from, to] = STEP_RANGE[step];
  await job.store.updateProgress(job.tripId, {
    status: "running",
    step,
    message,
    progress: Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction))),
  });
}

async function flushUsage(job: Job) {
  const records = job.budget.flush();
  if (records.length) await job.store.recordUsage(job.tripId, records).catch((e) => console.error("[agent] usage", e));
}

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
}

async function collectAll(
  job: Job,
  deps: AgentDeps,
  trip: TripInput,
  geo: GeocodeResult,
  maps: MapsProvider,
  mode: TravelMode,
  cached: CityData | null,
): Promise<Collected> {
  const countryCode = geo.countryCode!;
  const countryName = countryNameKo(countryCode);
  const center = geo.location;
  const isKr = countryCode === "KR";
  let done = 0;
  const total = (cached ? 0 : 3) + (isKr ? 0 : 1);
  const settle = async <T>(label: string, p: Promise<T>): Promise<T> => {
    try {
      return await p;
    } finally {
      done++;
      await progress(job, "collect", `${label} 완료 (${done}/${total})`, done / (total + 1));
    }
  };

  await progress(job, "collect", cached ? "저장된 도시 정보를 사용하고 근교 도시를 찾는 중" : "역사·관광청·명소·근교 도시를 동시에 조사하는 중");

  const [history, tourism, searched, nearby] = await Promise.allSettled([
    cached ? Promise.resolve(cached.background) : settle("역사·배경 조사", collectHistory(job.llm, deps.wiki, trip.cityName, geo.name)),
    cached ? Promise.resolve(cached.tourismBoard) : settle("관광청 조사", collectTourism(job.search, countryName, geo.name, countryCode)),
    cached ? Promise.resolve(cached.pois) : settle("명소 검색", searchCityPois(maps, center, geo.name)),
    isKr
      ? Promise.resolve({ towns: [] as NearbyTown[], warnings: [] as string[] })
      : settle(
          "근교 도시 조사",
          collectNearbyTowns({ llm: job.llm, geocoder: job.geocoder, maps, base: center, cityName: geo.name, countryName, style: trip.style, mode }),
        ),
  ]);

  const failures: unknown[] = [];
  const value = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    failures.push(r.reason);
    if (!(r.reason instanceof BudgetExceededError)) {
      console.error(`[agent] ${label} 실패`, r.reason);
      job.meta.warnings.push(`${label}에 실패해 해당 정보 없이 진행했습니다.`);
    }
    return null;
  };

  const background = value(history, "역사·배경 조사") as CityBackground | null;
  const tourismInfo = value(tourism, "관광청 조사") as TourismInfo | null;
  let pois = (value(searched, "명소 검색") as AgentPoi[] | null) ?? [];
  const nearbyResult = value(nearby, "근교 도시 조사");
  if (nearbyResult) job.meta.warnings.push(...nearbyResult.warnings);
  if (isKr) job.meta.notices.push("국내 도시는 근교 소도시 추천을 제공하지 않습니다.");

  if (!cached) {
    // 관광청 추천 명소를 지도에서 찾아 POI와 병합 (이름·좌표 100m 중복 제거)
    if (tourismInfo?.recommended.length && !failures.some((f) => f instanceof BudgetExceededError)) {
      const recommended = await lookupRecommended(maps, center, geo.name, tourismInfo.recommended).catch((e) => {
        if (e instanceof BudgetExceededError) failures.push(e);
        return [];
      });
      pois = mergePois(recommended, pois);
    } else {
      pois = mergePois([], pois);
    }
  }

  // 수집이 일부 실패한 도시는 캐시로 쓰지 않도록 즉시 만료된 시각으로 저장한다 (다음 요청에서 다시 수집)
  const complete = background !== null && tourismInfo !== null && pois.length > 0;
  const city = cached
    ? cached
    : await job.store.saveCity({
        name: geo.name,
        countryCode,
        lat: center.lat,
        lon: center.lng,
        background,
        tourismBoard: tourismInfo,
        pois,
        refreshedAt: complete ? job.now : new Date(job.now.getTime() - (CITY_CACHE_DAYS + 1) * 86_400_000),
      });
  await job.store.linkCity(job.tripId, city.id);

  const budgetError = failures.find((f) => f instanceof BudgetExceededError);
  if (budgetError) throw Object.assign(budgetError as Error, { collected: { city, nearby: nearbyResult?.towns ?? [] } });
  return { city: { ...city, pois: assignKeys(city.pois) }, nearby: nearbyResult?.towns ?? [] };
}

// ---------- 4~6. 배분 → 최적화 → 검증(재시도) ----------

interface PlanContext {
  job: Job;
  trip: TripInput;
  city: CityData;
  maps: MapsProvider;
  mode: TravelMode;
  nearby: NearbyTown[];
  base: { name: string; lat: number; lon: number };
  /** 진행 중 만들어진 일자 (예산 초과 시 부분 저장용) */
  plans: Map<number, DayPlan>;
}

async function planDays(ctx: PlanContext, assignments: Map<number, DayAssignment>, attempt: number) {
  const entries = [...assignments.values()].sort((a, b) => a.dayIndex - b.dayIndex);
  let i = 0;
  for (const assignment of entries) {
    // 재시도 중에는 진행률이 뒤로 가지 않도록 검증 단계 안에서 보고한다
    if (attempt === 1) await progress(ctx.job, "optimize", `day ${assignment.dayIndex + 1} 동선 계산 중`, i / entries.length);
    else await progress(ctx.job, "validate", `day ${assignment.dayIndex + 1} 동선 재계산 중 (재시도 ${attempt - 1})`, (attempt - 1) / (MAX_VALIDATION_RETRIES + 1));
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
    i++;
  }
}

function applyValidation(plan: DayPlan): DayPlan {
  const weekday = plan.weekday ? ["일", "월", "화", "수", "목", "금", "토"].indexOf(plan.weekday) : null;
  const issues = validateDay({ ...plan, weekday });
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

  await progress(job, "assign", `${dayIndexes.length}일 일정을 배분하는 중`);
  const first = await assignDays({
    llm: job.llm,
    trip,
    cityName: city.name,
    dayIndexes,
    pois: available(usedElsewhere),
    nearbyTowns: ctx.nearby.filter((t) => !townsElsewhere.has(t.name)),
    feedback: extraFeedback,
  });
  job.meta.warnings.push(...first.warnings);
  await progress(job, "assign", "일자 배분 완료", 1);
  await flushUsage(job);

  await planDays(ctx, first.days, 1);
  await progress(job, "optimize", "동선 계산 완료", 1);
  await flushUsage(job);

  await progress(job, "validate", "일정을 검증하는 중");
  for (const i of dayIndexes) applyValidation(ctx.plans.get(i)!);

  for (let attempt = 1; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    const failing = dayIndexes.filter((i) => !ctx.plans.get(i)!.validation.passed);
    if (failing.length === 0) break;
    await progress(job, "validate", `검증 실패 ${failing.length}일 재배치 중 (${attempt}/${MAX_VALIDATION_RETRIES})`, attempt / (MAX_VALIDATION_RETRIES + 1));

    const keep = new Set([...usedElsewhere, ...dayIndexes.filter((i) => !failing.includes(i)).flatMap((i) => ctx.plans.get(i)!.stops.map((s) => s.key))]);
    const feedback = failing
      .map((i) => `day ${i}:\n${issuesToFeedback(ctx.plans.get(i)!.validation.issues)}`)
      .join("\n");
    const retry = await assignDays({
      llm: job.llm,
      trip,
      cityName: city.name,
      dayIndexes: failing,
      pois: available(keep),
      nearbyTowns: ctx.nearby.filter((t) => ![...ctx.plans.values()].some((p) => p.dayTripTown === t.name && !failing.includes(p.dayIndex))),
      feedback,
    });
    job.meta.warnings.push(...retry.warnings);
    await planDays(ctx, retry.days, attempt + 1);
    for (const i of failing) applyValidation(ctx.plans.get(i)!);
    await flushUsage(job);
  }

  for (const i of dayIndexes) {
    const plan = ctx.plans.get(i)!;
    plan.needsReview = !plan.validation.passed;
  }
  await progress(job, "validate", "검증 완료", 1);
}

function finalizeMeta(job: Job, plans: Map<number, DayPlan>) {
  job.meta.needsReviewDays = [...plans.values()].filter((p) => p.needsReview).map((p) => p.dayIndex).sort((a, b) => a - b);
  job.meta.usage = job.budget.summary();
  job.meta.warnings = [...new Set(job.meta.warnings)];
  job.meta.notices = [...new Set(job.meta.notices)];
  if (job.step !== "queued") job.meta.stepDurationsMs[job.step] = Date.now() - job.stepStartedAt;
  job.stepSpan?.end();
  job.stepSpan = undefined;
}

/**
 * @param plans 여행 전체 일자 (meta.needsReviewDays 계산용)
 * @param saveDays 저장할 일자. 생략하면 plans 전체 (일자 재생성은 새로 만든 일자만 저장)
 */
async function savePartialAndFinish(
  job: Job,
  plans: Map<number, DayPlan>,
  nearby: NearbyTown[],
  error: BudgetExceededError,
  saveDays?: number[],
) {
  job.meta.partial = true;
  for (const p of plans.values()) p.needsReview = p.needsReview || !p.validation.passed;
  finalizeMeta(job, plans);
  const toSave = [...plans.values()].filter((p) => !saveDays || saveDays.includes(p.dayIndex));
  if (toSave.length) await job.store.saveDays(job.tripId, toSave);
  if (nearby.length) await job.store.saveNearby(job.tripId, nearby);
  await job.store.finish(job.tripId, {
    status: "done",
    meta: job.meta,
    errorMessage: `${error.message}: 비용 상한에 도달해 중단했습니다. 만들어진 부분까지만 저장했습니다.`,
    message: "부분 결과 저장 완료",
  });
}

async function failJob(job: Job, error: unknown) {
  console.error(`[agent] trip ${job.tripId} failed at ${job.step}`, error);
  job.stepSpan?.recordException(error as Error);
  job.stepSpan?.setStatus({ code: SpanStatusCode.ERROR });
  finalizeMeta(job, new Map());
  const message = error instanceof AgentError ? error.message : `일정 생성 중 오류가 발생했습니다 (단계: ${job.step}).`;
  await job.store
    .finish(job.tripId, { status: "failed", meta: job.meta, errorMessage: message, message })
    .catch((e) => console.error("[agent] failed to mark trip failed", e));
}

// ---------- 공개 API ----------

/** 여행 1건 전체 생성. 예외를 밖으로 던지지 않는다 (결과는 DB 상태로 확인) */
export function runTripJob(tripId: string, deps: AgentDeps): Promise<void> {
  // 루트 span 아래에 단계 span(agent.step.*)과 외부 호출 span(external.*)이 붙는다
  return withSpan("agent.runTripJob", { "trippilot.trip_id": tripId }, () => runTripJobInner(tripId, deps));
}

async function runTripJobInner(tripId: string, deps: AgentDeps): Promise<void> {
  const job = createJob(tripId, deps);
  const plans = new Map<number, DayPlan>();
  let nearby: NearbyTown[] = [];
  try {
    const trip = await deps.store.getTrip(tripId);
    if (!trip) return; // 삭제됨

    // 1. 입력 정규화 (PRD: 항상 Google Geocoding으로 국가코드 확정)
    await progress(job, "normalize", `'${trip.cityName}' 위치를 확인하는 중`);
    const geo = pickGeocode(await job.geocoder.geocode(trip.cityName, { language: "ko" }), trip, job.meta.warnings);
    const countryCode = geo.countryCode!;
    const base = { name: `${geo.name} 중심 (숙소 거점)`, lat: geo.location.lat, lon: geo.location.lng };
    const maps = meterMaps(deps.mapsFor(countryCode), job.budget);
    const mode = tripMode(trip.transport, countryCode);
    Object.assign(job.meta, { base, countryCode });
    if (countryCode === "KR") job.meta.travelBasisNotice = KR_TRAVEL_NOTICE;
    await progress(job, "normalize", `${geo.formattedAddress} (${countryCode}) 확인`, 1);

    // 2. 캐시 확인
    await progress(job, "cache", "저장된 도시 정보를 확인하는 중");
    const cached = await deps.store.findFreshCity(geo.name, countryCode, CITY_CACHE_DAYS, job.now);
    job.meta.cache = { hit: Boolean(cached), cityRefreshedAt: cached?.refreshedAt.toISOString() ?? null };
    await progress(job, "cache", cached ? "30일 이내 수집한 도시 정보를 재사용합니다" : "새로 수집합니다", 1);

    // 3. 병렬 수집
    let collected: Collected;
    try {
      collected = await collectAll(job, deps, trip, geo, maps, mode, cached);
    } catch (e) {
      const partial = (e as { collected?: Collected }).collected;
      if (partial) nearby = partial.nearby;
      throw e;
    }
    nearby = collected.nearby;
    await flushUsage(job);
    if (collected.city.pois.length === 0) throw new AgentError("방문할 명소를 찾지 못했습니다.");
    if (job.meta.travelBasisNotice === null && mode === "transit") {
      job.meta.notices.push("대중교통 이동시간은 지도 API 기준이며, 데이터가 없는 구간은 자동차 시간으로 대체했습니다.");
    }

    // 4~6. 배분 → 최적화 → 검증
    const ctx: PlanContext = { job, trip, city: collected.city, maps, mode, nearby, base, plans };
    await buildItinerary(ctx, Array.from({ length: trip.days }, (_, i) => i));

    // 7. 저장
    await progress(job, "save", "결과를 저장하는 중");
    finalizeMeta(job, plans);
    await deps.store.saveDays(tripId, [...plans.values()]);
    await deps.store.saveNearby(tripId, nearby);
    await deps.store.finish(tripId, {
      status: "done",
      meta: job.meta,
      errorMessage: null,
      message: job.meta.needsReviewDays.length ? `완료 (검증 필요 ${job.meta.needsReviewDays.length}일)` : "완료",
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) await savePartialAndFinish(job, plans, nearby, error);
    else await failJob(job, error);
  } finally {
    await flushUsage(job);
  }
}

/** 특정 일자만 4~6단계 재실행 (FR-11). 다른 일자에 쓴 POI는 피한다 */
export function runDayRegeneration(tripId: string, dayIndex: number, deps: AgentDeps): Promise<void> {
  return withSpan("agent.regenerateDay", { "trippilot.trip_id": tripId, "trippilot.day_index": dayIndex }, () =>
    runDayRegenerationInner(tripId, dayIndex, deps),
  );
}

async function runDayRegenerationInner(tripId: string, dayIndex: number, deps: AgentDeps): Promise<void> {
  const job = createJob(tripId, deps);
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

    const maps = meterMaps(deps.mapsFor(city.countryCode), job.budget);
    const mode = tripMode(trip.transport, city.countryCode);
    const base = job.meta.base ?? { name: `${city.name} 중심 (숙소 거점)`, lat: city.lat, lon: city.lon };
    const pois = assignKeys(city.pois);
    // 저장된 일정은 이전 키로 기록돼 있으므로 POI id 기준으로 새 키에 맞춘다
    const keyById = new Map(pois.map((p) => [p.id, p.key]));
    for (const p of plans.values()) for (const s of p.stops) s.key = (s.poiId && keyById.get(s.poiId)) || s.key;

    const ctx: PlanContext = { job, trip, city: { ...city, pois }, maps, mode, nearby, base, plans };
    const previous = current?.stops.map((s) => s.name).join(", ");
    await buildItinerary(ctx, [dayIndex], previous ? `사용자가 day ${dayIndex} 재생성을 요청했다. 기존 구성(${previous})과 다르게 짜라.` : undefined);

    await progress(job, "save", `day ${dayIndex + 1} 저장 중`);
    finalizeMeta(job, plans);
    await deps.store.saveDays(tripId, [plans.get(dayIndex)!]);
    await deps.store.finish(tripId, { status: "done", meta: job.meta, errorMessage: null, message: `day ${dayIndex + 1} 재생성 완료` });
  } catch (error) {
    // 새 일정을 만들기 전에 실패했다면 기존 일자를 되돌려 needsReviewDays가 DB의 일정과 맞게 한다
    const regenerated = plans.has(dayIndex);
    if (!regenerated && current) plans.set(dayIndex, current);
    if (error instanceof BudgetExceededError) {
      await savePartialAndFinish(job, plans, [], error, regenerated ? [dayIndex] : []);
    } else {
      // 재생성 실패가 기존 일정까지 실패로 만들지 않도록 done을 유지하고 오류만 남긴다
      console.error(`[agent] trip ${tripId} day ${dayIndex} regeneration failed`, error);
      finalizeMeta(job, plans);
      const message = error instanceof AgentError ? error.message : `day ${dayIndex + 1} 재생성 중 오류가 발생했습니다.`;
      await deps.store
        .finish(tripId, { status: "done", meta: job.meta, errorMessage: message, message })
        .catch((e) => console.error("[agent] failed to record regeneration error", e));
    }
  } finally {
    await flushUsage(job);
  }
}
