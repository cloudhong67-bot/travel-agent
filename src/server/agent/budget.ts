import type { LlmProvider, LlmRequest, LlmResponse } from "@/server/adapters/llm/types";
import type { LatLng, MapsProvider, SearchPlacesOptions, TravelMode } from "@/server/adapters/maps/types";
import type { WebSearchOptions } from "@/server/adapters/search/types";
import { withSpan } from "@/server/telemetry";
import type { AgentLimits, MapsSku, SearchProvider, UsageRecord, UsageSummary } from "./types";

export class BudgetExceededError extends Error {
  constructor(readonly kind: "gemini" | "maps", readonly limit: number) {
    super(kind === "gemini" ? `Gemini 호출 상한(${limit}회) 도달` : `지도 API 호출 상한(${limit}회) 도달`);
    this.name = "BudgetExceededError";
  }
}

/**
 * 요청(여행 1건)당 비용 가드. 호출 전에 예상 호출 수로 상한을 확인하고(초과 시 BudgetExceededError),
 * 호출 후 토큰·SKU 사용량을 누적한다. 누적분은 flush()로 UsageLog에 기록한다.
 */
export class Budget {
  private gemini = 0;
  private maps = 0;
  private searchQueries = 0;
  private tokens = { input: 0, output: 0, thought: 0 };
  private skus: Partial<Record<MapsSku, number>> = {};
  private pending: UsageRecord[] = [];

  constructor(readonly limits: AgentLimits) {}

  reserveGemini(): void {
    if (this.gemini + 1 > this.limits.maxGeminiCalls) throw new BudgetExceededError("gemini", this.limits.maxGeminiCalls);
    this.gemini++;
  }

  reserveMaps(calls: number): void {
    if (calls <= 0) return;
    if (this.maps + calls > this.limits.maxMapsCalls) throw new BudgetExceededError("maps", this.limits.maxMapsCalls);
    this.maps += calls;
  }

  recordLlm(provider: "gemini" | "gemini-search", usage: { inputTokens: number; outputTokens: number; thoughtTokens: number }, searchQueries = 0) {
    this.tokens.input += usage.inputTokens;
    this.tokens.output += usage.outputTokens;
    this.tokens.thought += usage.thoughtTokens;
    this.searchQueries += searchQueries;
    // 사고 토큰은 출력 단가로 과금되므로 outputTokens에 합산해 기록한다.
    this.pending.push({
      provider,
      calls: provider === "gemini-search" ? Math.max(1, searchQueries) : 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens + usage.thoughtTokens,
    });
  }

  recordMaps(provider: "google-maps" | "naver", calls: number, sku: MapsSku, units: number) {
    if (calls <= 0) return;
    this.skus[sku] = (this.skus[sku] ?? 0) + units;
    this.pending.push({ provider, calls, inputTokens: 0, outputTokens: 0 });
  }

  /** 기록 대기 중인 사용량을 꺼낸다 (공급자별로 합쳐 행 수를 줄임) */
  flush(): UsageRecord[] {
    const merged = new Map<string, UsageRecord>();
    for (const r of this.pending) {
      const prev = merged.get(r.provider);
      merged.set(
        r.provider,
        prev
          ? { ...prev, calls: prev.calls + r.calls, inputTokens: prev.inputTokens + r.inputTokens, outputTokens: prev.outputTokens + r.outputTokens }
          : { ...r },
      );
    }
    this.pending = [];
    return [...merged.values()];
  }

  summary(): UsageSummary {
    return {
      geminiCalls: this.gemini,
      searchQueries: this.searchQueries,
      mapsCalls: this.maps,
      tokens: { ...this.tokens },
      skus: { ...this.skus },
    };
  }
}

// ---------- 계측 래퍼 ----------

// 외부 API 호출마다 span을 만든다 (Azure Monitor 배포판은 fetch를 자동 계측하지 않음)

export function meterLlm(llm: LlmProvider, budget: Budget): LlmProvider {
  return {
    async generate(request: LlmRequest): Promise<LlmResponse> {
      budget.reserveGemini();
      return withSpan("external.gemini.generate", { "gen_ai.system": "gemini", "trippilot.thinking": request.thinkingLevel ?? "low", "trippilot.tools": request.tools?.length ?? 0 }, async (span) => {
        const res = await llm.generate(request);
        budget.recordLlm("gemini", res.usage);
        span.setAttributes({
          "gen_ai.response.model": res.model,
          "gen_ai.usage.input_tokens": res.usage.inputTokens,
          "gen_ai.usage.output_tokens": res.usage.outputTokens + res.usage.thoughtTokens,
          "trippilot.function_calls": res.functionCalls.length,
        });
        return res;
      });
    },
  };
}

export function meterSearch(search: SearchProvider, budget: Budget): SearchProvider {
  return {
    async search(query: string, options?: WebSearchOptions) {
      budget.reserveGemini();
      return withSpan("external.gemini.googleSearch", { "gen_ai.system": "gemini" }, async (span) => {
        const res = await search.search(query, options);
        budget.recordLlm(
          "gemini-search",
          res.usage ?? { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 },
          res.searchQueries?.length ?? 1,
        );
        span.setAttributes({ "trippilot.search_queries": res.searchQueries?.length ?? 0, "trippilot.sources": res.sources.length });
        return res;
      });
    },
  };
}

const samePoint = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/** 어댑터 내부 동작(분할 호출·쌍별 호출)을 반영한 실제 HTTP 호출 수 추정 */
export function estimateMatrixCalls(provider: "google" | "naver", origins: LatLng[], destinations: LatLng[], mode: TravelMode) {
  if (origins.length === 0 || destinations.length === 0) return { calls: 0, units: 0 };
  if (provider === "naver") {
    if (mode !== "driving") return { calls: 0, units: 0 };
    let pairs = 0;
    for (const o of origins) for (const d of destinations) if (!samePoint(o, d)) pairs++;
    return { calls: pairs, units: pairs };
  }
  const limit = mode === "transit" ? 100 : 625;
  const rows = Math.max(1, Math.floor(limit / destinations.length));
  return { calls: Math.ceil(origins.length / rows), units: origins.length * destinations.length };
}

export function estimateRouteCalls(provider: "google" | "naver", points: LatLng[], mode: TravelMode) {
  if (provider === "naver") return mode === "driving" && points.length <= 17 ? 1 : 0;
  return mode === "transit" && points.length > 2 ? points.length - 1 : 1;
}

export function meterMaps(maps: MapsProvider, budget: Budget): MapsProvider {
  const google = maps.name === "google";
  const provider = google ? "google-maps" : "naver";
  const span = <T>(method: string, calls: number, fn: () => Promise<T>) =>
    withSpan(`external.${maps.name}.${method}`, { "trippilot.maps.provider": maps.name, "trippilot.maps.calls": calls }, () => fn());
  return {
    name: maps.name,
    async geocode(query, options) {
      budget.reserveMaps(1);
      budget.recordMaps(provider, 1, google ? "google.geocode" : "naver.geocode", 1);
      return span("geocode", 1, () => maps.geocode(query, options));
    },
    async searchPlaces(query: string, options?: SearchPlacesOptions) {
      budget.reserveMaps(1);
      budget.recordMaps(provider, 1, google ? "google.placesTextSearch" : "naver.localSearch", 1);
      return span("searchPlaces", 1, () => maps.searchPlaces(query, options));
    },
    async travelTimeMatrix(origins, destinations, mode) {
      const { calls, units } = estimateMatrixCalls(maps.name, origins, destinations, mode);
      budget.reserveMaps(calls);
      budget.recordMaps(provider, calls, google ? "google.routeMatrixElement" : "naver.directions5", units);
      return span("travelTimeMatrix", calls, () => maps.travelTimeMatrix(origins, destinations, mode));
    },
    async routeGeometry(points, mode) {
      const calls = estimateRouteCalls(maps.name, points, mode);
      budget.reserveMaps(calls);
      budget.recordMaps(provider, calls, google ? "google.computeRoutes" : "naver.directions15", calls);
      return span("routeGeometry", calls, () => maps.routeGeometry(points, mode));
    },
  };
}
