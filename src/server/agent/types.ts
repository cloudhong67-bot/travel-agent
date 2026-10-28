import type { AgentStep, BackgroundField, RecommendedStay, TripStatus, UsageProvider } from "@/lib/schemas";
import type { WikipediaKnowledge } from "@/server/adapters/knowledge/wikipedia";
import type { LlmProvider, LlmUsage } from "@/server/adapters/llm/types";
import type { MapsProvider, TravelMode } from "@/server/adapters/maps/types";
import type { WebSearchOptions, WebSearchResult, WebSource } from "@/server/adapters/search/types";

// ---------- 도메인 ----------

export type PoiCategory = "sight" | "museum" | "food";

export interface AgentPoi {
  /** LLM에 보여주는 짧은 키 (P01…). LLM은 이 키만 쓸 수 있다 */
  key: string;
  /** DB Poi.id (저장 후 채워짐) */
  id?: string;
  /** 지도 공급자의 장소 ID (Google place id 등). 중복 제거에 가장 확실한 기준 */
  externalId?: string;
  name: string;
  category: PoiCategory;
  lat: number;
  lon: number;
  /** 공급자 원문 요일별 운영시간. 출처에 없으면 null (지어내지 않음) */
  hours: string[] | null;
  sourceUrl: string | null;
  rating?: number;
  origin: "google" | "naver" | "tourism";
}

export interface CityBackground {
  history: string | null;
  culture: string | null;
  bestTime: string | null;
  etiquette: string | null;
  sources: WebSource[];
  /** 출처 원문 대신 AI(Gemini) 일반 지식으로 채운 항목 */
  aiFields: BackgroundField[];
  /** aiFields가 하나라도 있으면 true */
  isAiSummary: boolean;
  /** AI 요약을 만들지 못해 위키 원문 소개를 그대로 담았는지 */
  isOriginalText: boolean;
  /** 번역하지 못한 원문의 언어 (한국어이거나 번역했으면 null) */
  untranslatedLang: string | null;
}

export interface TourismInfo {
  /** official: 공식 관광청 기준, alternative: 위키여행·여행 플랫폼 등 대체 출처 */
  sourceType: "official" | "alternative";
  summary: string;
  recommended: string[];
  festivals: string[];
  transitPasses: string[];
  /** 정부·관광청 도메인을 앞에 둔 출처 */
  sources: (WebSource & { official: boolean })[];
  searchQueries: string[];
  /** Google 검색 추천 HTML (그라운딩 결과 표시 시 함께 노출해야 함) */
  searchEntryPointHtml: string | null;
  /** 요약을 번역하지 못한 경우 원문의 언어 */
  untranslatedLang: string | null;
}

export interface CityData {
  id: string;
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
  background: CityBackground | null;
  tourismBoard: TourismInfo | null;
  pois: AgentPoi[];
  refreshedAt: Date;
}

export interface NearbyTown {
  name: string;
  lat: number;
  lon: number;
  travelMins: number;
  kind: "dayTrip" | "overnight";
  reason: string;
}

export interface TripInput {
  id: string;
  cityName: string;
  countryCode: string | null;
  days: number;
  /** true면 추천 체류 일수로 days를 정한다 */
  autoDays: boolean;
  /** YYYY-MM-DD 또는 null */
  startDate: string | null;
  style: string;
  transport: "transit" | "driving" | "walking" | "mixed";
  budget: "low" | "medium" | "high" | null;
  status: TripStatus;
  cityId: string | null;
}

export interface ValidationIssue {
  rule: "closedDay" | "travelRatio" | "missingCoords" | "missingSource";
  message: string;
  poiKey?: string;
}

export interface PlannedStop {
  order: number;
  key: string;
  poiId: string | null;
  name: string;
  category: PoiCategory | "town";
  lat: number;
  lon: number;
  arrive: string;
  depart: string;
  stayMins: number;
  travelMinsFromPrev: number;
  sourceUrl: string | null;
  openingHours: string[] | null;
}

export interface DayPlan {
  dayIndex: number;
  title: string;
  date: string | null;
  weekday: string | null;
  mode: TravelMode;
  /** 실제 이동시간 산출 기준 (국내는 driving, 대중교통 데이터가 없으면 driving 대체) */
  travelBasis: TravelMode | "mixed" | "estimated";
  base: { name: string; lat: number; lon: number };
  stops: PlannedStop[];
  returnTravelMins: number;
  totals: { travelMins: number; stayMins: number; travelRatio: number };
  dayTripTown: string | null;
  routeGeo: { type: "LineString"; coordinates: [number, number][] } | null;
  validation: { passed: boolean; issues: ValidationIssue[] };
  needsReview: boolean;
  attempts: number;
}

export interface TripMeta {
  version: 1;
  /** 명소 규모로 산정한 추천 체류 일수 (stay.ts) */
  recommendedStay: RecommendedStay | null;
  base: { name: string; lat: number; lon: number } | null;
  countryCode: string | null;
  travelBasisNotice: string | null;
  notices: string[];
  warnings: string[];
  needsReviewDays: number[];
  partial: boolean;
  cache: { hit: boolean; cityRefreshedAt: string | null };
  usage: UsageSummary | null;
  stepDurationsMs: Partial<Record<AgentStep, number>>;
}

// ---------- 사용량 ----------

export type MapsSku =
  | "google.geocode"
  | "google.placesTextSearch"
  | "google.routeMatrixElement"
  | "google.computeRoutes"
  | "naver.geocode"
  | "naver.directions5"
  | "naver.directions15"
  | "naver.localSearch";

export interface UsageSummary {
  geminiCalls: number;
  searchQueries: number;
  mapsCalls: number;
  tokens: { input: number; output: number; thought: number };
  skus: Partial<Record<MapsSku, number>>;
}

export interface UsageRecord {
  provider: UsageProvider;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

// ---------- 의존성 ----------

export interface ProgressUpdate {
  status: TripStatus;
  step: AgentStep;
  message: string;
  progress: number;
  errorMessage?: string | null;
}

/** 오케스트레이터가 쓰는 저장소. 운영은 Prisma(src/server/db/agentStore.ts), 테스트·평가는 메모리 구현 */
export interface AgentStore {
  getTrip(tripId: string): Promise<TripInput | null>;
  updateProgress(tripId: string, update: ProgressUpdate): Promise<void>;
  findFreshCity(name: string, countryCode: string, maxAgeDays: number, now: Date): Promise<CityData | null>;
  getCity(cityId: string): Promise<CityData | null>;
  /** (name, countryCode) 기준 upsert, POI는 통째로 교체. 저장된 POI에 id를 채워 돌려준다 */
  saveCity(city: Omit<CityData, "id">): Promise<CityData>;
  linkCity(tripId: string, cityId: string): Promise<void>;
  getDays(tripId: string): Promise<DayPlan[]>;
  /** 해당 일자들만 교체 (없으면 생성) */
  saveDays(tripId: string, days: DayPlan[]): Promise<void>;
  /** 일정 전체 교체: 기존 일자를 모두 지우고 days로 바꾼다 (일정 조정) */
  replaceDays(tripId: string, days: DayPlan[]): Promise<void>;
  /** 여행 일수·출발일 변경 (추천 일수 자동 결정·일정 조정). startDate를 생략하면 그대로 둔다 */
  updateSchedule(tripId: string, schedule: { days: number; startDate?: string | null }): Promise<void>;
  getNearby(tripId: string): Promise<NearbyTown[]>;
  saveNearby(tripId: string, towns: NearbyTown[]): Promise<void>;
  getMeta(tripId: string): Promise<TripMeta | null>;
  finish(tripId: string, result: { status: "done" | "failed"; meta: TripMeta; errorMessage: string | null; message: string }): Promise<void>;
  recordUsage(tripId: string, records: UsageRecord[]): Promise<void>;
}

export interface SearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult & { usage?: LlmUsage }>;
}

export interface AgentLimits {
  maxGeminiCalls: number;
  maxMapsCalls: number;
}

export interface AgentDeps {
  store: AgentStore;
  llm: LlmProvider;
  search: SearchProvider;
  /** 1단계 도시 식별용 (PRD 7장: 항상 Google Geocoding) */
  geocoder: MapsProvider;
  /** 국가코드별 지도 공급자 (KR → Naver) */
  mapsFor: (countryCode: string) => MapsProvider;
  /** 배경지식(위키백과·위키여행)과 관광청 대체 출처(위키여행 요약) */
  wiki: Pick<WikipediaKnowledge, "getCityKnowledge" | "getSummary">;
  limits?: Partial<AgentLimits>;
  now?: () => Date;
}

export const DEFAULT_LIMITS: AgentLimits = { maxGeminiCalls: 15, maxMapsCalls: 200 };
export const CITY_CACHE_DAYS = 30;
