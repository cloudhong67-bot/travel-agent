/**
 * 에이전트 작업 1건의 생명주기: 진행률 기록, 단계 시간·span, 사용량 기록, 결과 meta 정리, 완료·실패·부분 저장.
 * 파이프라인(무엇을 할지)은 orchestrator.ts, 작업 상태(어떻게 기록할지)는 여기에 둔다.
 */
import { SpanStatusCode, type Span } from "@opentelemetry/api";
import type { AgentStep } from "@/lib/schemas";
import type { MapsProvider } from "@/server/adapters/maps/types";
import type { LlmProvider } from "@/server/adapters/llm/types";
import { tracer } from "@/server/telemetry";
import { Budget, BudgetExceededError, meterLlm, meterMaps, meterSearch } from "./budget";
import { DEFAULT_LIMITS, type AgentDeps, type AgentStore, type DayPlan, type NearbyTown, type SearchProvider, type TripMeta } from "./types";

/** 사용자에게 그대로 보여줘도 되는 오류 */
export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export type ActiveStep = Exclude<AgentStep, "queued" | "done" | "failed">;

// 단계별 진행률 구간 [시작, 완료]
const STEP_RANGE: Record<ActiveStep, [number, number]> = {
  normalize: [2, 8],
  cache: [10, 12],
  collect: [15, 50],
  assign: [52, 62],
  optimize: [64, 78],
  validate: [80, 90],
  save: [92, 99],
};

/** 진행 기록이 연속으로 이만큼 실패하면(DB 장애·여행 삭제) 작업을 멈춘다. 그 전까지는 경고만 남기고 계속한다 */
const MAX_PROGRESS_FAILURES = 3;

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

export class AgentJob {
  readonly budget: Budget;
  /** 비용 상한·계측이 걸린 외부 호출 */
  readonly llm: LlmProvider;
  readonly search: SearchProvider;
  readonly geocoder: MapsProvider;
  readonly now: Date;
  meta: TripMeta = newMeta();

  private step: AgentStep = "queued";
  private stepStartedAt = Date.now();
  /** 현재 단계의 OpenTelemetry span (agent.step.<단계>) */
  private stepSpan?: Span;
  private progressFailures = 0;

  constructor(
    readonly tripId: string,
    private readonly deps: AgentDeps,
  ) {
    this.budget = new Budget({ ...DEFAULT_LIMITS, ...deps.limits });
    this.llm = meterLlm(deps.llm, this.budget);
    this.search = meterSearch(deps.search, this.budget);
    this.geocoder = meterMaps(deps.geocoder, this.budget);
    this.now = deps.now?.() ?? new Date();
  }

  get store(): AgentStore {
    return this.deps.store;
  }

  get currentStep(): AgentStep {
    return this.step;
  }

  /** 국가에 맞는 지도 공급자 (계측 포함) */
  mapsFor(countryCode: string): MapsProvider {
    return meterMaps(this.deps.mapsFor(countryCode), this.budget);
  }

  /**
   * 진행 상황 기록. 진행률은 보조 정보이므로 일시적인 기록 실패로 작업 전체를 실패시키지 않는다.
   * 연속 실패가 MAX_PROGRESS_FAILURES에 이르면 그때 예외를 던진다.
   */
  async progress(step: ActiveStep, message: string, fraction = 0): Promise<void> {
    if (step !== this.step) this.enterStep(step);
    this.stepSpan?.addEvent(message);
    const [from, to] = STEP_RANGE[step];
    try {
      await this.store.updateProgress(this.tripId, {
        status: "running",
        step,
        message,
        progress: Math.round(from + (to - from) * Math.min(1, Math.max(0, fraction))),
      });
      this.progressFailures = 0;
    } catch (error) {
      if (++this.progressFailures >= MAX_PROGRESS_FAILURES) throw error;
      console.warn(`[agent] trip ${this.tripId} 진행 기록 실패 (${this.progressFailures}/${MAX_PROGRESS_FAILURES}) — 계속 진행`, error);
    }
  }

  private enterStep(step: ActiveStep) {
    this.closeStep();
    this.step = step;
    this.stepStartedAt = Date.now();
    this.stepSpan = tracer.startSpan(`agent.step.${step}`, { attributes: { "trippilot.trip_id": this.tripId } });
  }

  private closeStep() {
    if (this.step !== "queued") this.meta.stepDurationsMs[this.step] = Date.now() - this.stepStartedAt;
    this.stepSpan?.end();
    this.stepSpan = undefined;
  }

  /** 누적 사용량을 UsageLog에 기록한다 (실패해도 작업은 계속) */
  async flushUsage(): Promise<void> {
    const records = this.budget.flush();
    if (records.length) await this.store.recordUsage(this.tripId, records).catch((e) => console.error("[agent] usage", e));
  }

  /** 저장 직전 meta 정리 (검증 필요 일자·사용량·중복 제거·단계 시간) */
  finalize(plans: Map<number, DayPlan>): void {
    this.meta.needsReviewDays = [...plans.values()].filter((p) => p.needsReview).map((p) => p.dayIndex).sort((a, b) => a - b);
    this.meta.usage = this.budget.summary();
    this.meta.warnings = [...new Set(this.meta.warnings)];
    this.meta.notices = [...new Set(this.meta.notices)];
    this.closeStep();
  }

  /** 정상 완료 */
  async complete(plans: Map<number, DayPlan>, opts: { saveDays: DayPlan[]; nearby?: NearbyTown[]; message: string }): Promise<void> {
    this.finalize(plans);
    await this.store.saveDays(this.tripId, opts.saveDays);
    if (opts.nearby) await this.store.saveNearby(this.tripId, opts.nearby);
    await this.store.finish(this.tripId, { status: "done", meta: this.meta, errorMessage: null, message: opts.message });
  }

  /**
   * 비용 상한 도달: 만들어진 부분까지 저장하고 done으로 끝낸다.
   * @param plans 여행 전체 일자 (meta.needsReviewDays 계산용)
   * @param saveDays 저장할 일자. 생략하면 plans 전체 (일자 재생성은 새로 만든 일자만 저장)
   */
  async completePartial(plans: Map<number, DayPlan>, nearby: NearbyTown[], error: BudgetExceededError, saveDays?: number[]): Promise<void> {
    this.meta.partial = true;
    for (const p of plans.values()) p.needsReview = p.needsReview || !p.validation.passed;
    this.finalize(plans);
    const toSave = [...plans.values()].filter((p) => !saveDays || saveDays.includes(p.dayIndex));
    if (toSave.length) await this.store.saveDays(this.tripId, toSave);
    if (nearby.length) await this.store.saveNearby(this.tripId, nearby);
    await this.store.finish(this.tripId, {
      status: "done",
      meta: this.meta,
      errorMessage: `${error.message}: 비용 상한에 도달해 중단했습니다. 만들어진 부분까지만 저장했습니다.`,
      message: "부분 결과 저장 완료",
    });
  }

  /**
   * 실패 기록. AgentError는 메시지를 그대로, 그 밖의 예외는 일반 문구로 남긴다 (내부 메시지 비노출).
   * @param keepDone 일자 재생성처럼 기존 결과가 있는 작업은 done을 유지하고 오류만 남긴다
   */
  async fail(error: unknown, opts: { plans?: Map<number, DayPlan>; keepDone?: boolean; fallbackMessage: string }): Promise<void> {
    console.error(`[agent] trip ${this.tripId} failed at ${this.step}`, error);
    this.stepSpan?.recordException(error as Error);
    this.stepSpan?.setStatus({ code: SpanStatusCode.ERROR });
    this.finalize(opts.plans ?? new Map());
    const message = error instanceof AgentError ? error.message : opts.fallbackMessage;
    await this.store
      .finish(this.tripId, { status: opts.keepDone ? "done" : "failed", meta: this.meta, errorMessage: message, message })
      .catch((e) => console.error("[agent] failed to record failure", e));
  }
}
