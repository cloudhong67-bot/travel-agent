/**
 * API 입출력 Zod 스키마 — 단일 진실 원천.
 * 라우트 검증, 응답 타입, OpenAPI 문서(src/lib/openapi.ts)가 모두 이 파일에서 나온다.
 * `.meta({ id })`가 붙은 스키마는 OpenAPI components/schemas에 등록된다.
 */
import { z } from "zod";

const isoDateTime = z.iso.datetime({ offset: true }).meta({ example: "2026-10-27T09:00:00.000Z" });

// ---- 공통 ----

export const ApiErrorSchema = z
  .object({
    code: z.string().meta({ example: "NOT_FOUND" }),
    message: z.string().meta({ example: "여행을 찾을 수 없습니다." }),
  })
  .meta({ id: "ApiError", description: "모든 오류 응답의 공통 형식" });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const TripStatusSchema = z.enum(["queued", "running", "done", "failed"]).meta({ id: "TripStatus" });
export type TripStatus = z.infer<typeof TripStatusSchema>;

export const AgentStepSchema = z
  .enum(["queued", "normalize", "cache", "collect", "assign", "optimize", "validate", "save", "done", "failed"])
  .meta({ id: "AgentStep", description: "에이전트 파이프라인 단계 (PRD 7장)" });
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const TransportSchema = z
  .enum(["transit", "driving", "walking", "mixed"])
  .meta({ id: "Transport", description: "주 이동수단" });

export const BudgetSchema = z
  .enum(["low", "medium", "high"])
  .meta({ id: "Budget", description: "예산 수준 (식당·유료 명소 선택에 반영)" });
export type Budget = z.infer<typeof BudgetSchema>;

export const UsageProviderSchema = z
  .enum(["gemini", "gemini-search", "google-maps", "naver", "trip"])
  .meta({ description: "trip = 일정 생성 1건 (하루 생성 한도 계산용)" });
export type UsageProvider = z.infer<typeof UsageProviderSchema>;

// ---- 경로 파라미터 ----

export const TripIdParamsSchema = z.object({ id: z.uuid() });
export const CityIdParamsSchema = z.object({ id: z.uuid() });
export const DayParamsSchema = z.object({
  id: z.uuid(),
  dayIndex: z.coerce.number().int().min(0).max(30),
});

// ---- 요청 ----

export const CreateTripRequestSchema = z
  .strictObject({
    city: z.string().trim().min(1).max(100).meta({ example: "포르투" }),
    countryCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "ISO 3166-1 alpha-2 국가 코드여야 합니다")
      .transform((v) => v.toUpperCase())
      .optional()
      .meta({ description: "동명 도시 구분용 국가 코드", example: "PT" }),
    days: z.number().int().min(1).max(14).meta({ example: 5 }),
    startDate: z.iso.date().optional().meta({ example: "2027-05-01" }),
    style: z.string().trim().min(1).max(100).meta({ example: "역사,미식" }),
    transport: TransportSchema,
    budget: BudgetSchema.optional(),
  })
  .meta({ id: "CreateTripRequest" });
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

export const ListTripsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
export type ListTripsQuery = z.infer<typeof ListTripsQuerySchema>;

export const UnlockFormSchema = z.object({
  token: z.string().min(1).max(512),
  next: z.string().max(2048).optional(),
});

// ---- 응답 ----

export const CreateTripResponseSchema = z
  .object({
    tripId: z.uuid(),
    status: TripStatusSchema,
    eventsUrl: z.string().meta({ example: "/api/v1/trips/3f2c.../events" }),
  })
  .meta({ id: "CreateTripResponse" });

export const TripSummarySchema = z
  .object({
    id: z.uuid(),
    cityName: z.string(),
    countryCode: z.string().nullable(),
    cityId: z.uuid().nullable(),
    days: z.number().int(),
    startDate: isoDateTime.nullable(),
    style: z.string(),
    transport: z.string(),
    budget: BudgetSchema.nullable(),
    status: TripStatusSchema,
    progress: z.number().int().min(0).max(100),
    createdAt: isoDateTime,
  })
  .meta({ id: "TripSummary" });
export type TripSummary = z.infer<typeof TripSummarySchema>;

export const TripListResponseSchema = z
  .object({
    items: z.array(TripSummarySchema),
    nextCursor: z.uuid().nullable(),
  })
  .meta({ id: "TripListResponse" });

// ---- 에이전트 결과 (TripDay.stops / Trip.meta / City JSON 컬럼의 구조) ----

const TravelModeSchema = z.enum(["driving", "walking", "transit", "bicycling"]);
const PointSchema = z.object({ name: z.string(), lat: z.number(), lon: z.number() });
const WebSourceSchema = z.object({ title: z.string(), url: z.string() });

export const PlannedStopSchema = z
  .object({
    order: z.number().int(),
    key: z.string(),
    poiId: z.string().nullable(),
    name: z.string(),
    category: z.enum(["sight", "museum", "food", "town"]),
    lat: z.number(),
    lon: z.number(),
    arrive: z.string().meta({ example: "09:12" }),
    depart: z.string(),
    stayMins: z.number(),
    travelMinsFromPrev: z.number(),
    sourceUrl: z.string().nullable(),
    openingHours: z.array(z.string()).nullable().meta({ description: "공급자 원문 운영시간. 출처에 없으면 null" }),
  })
  .meta({ id: "PlannedStop" });
export type PlannedStopView = z.infer<typeof PlannedStopSchema>;

export const ValidationIssueSchema = z
  .object({
    rule: z.enum(["closedDay", "travelRatio", "missingCoords", "missingSource"]),
    message: z.string(),
    poiKey: z.string().optional(),
  })
  .meta({ id: "ValidationIssue" });

export const GeoLineStringSchema = z
  .object({ type: z.literal("LineString"), coordinates: z.array(z.tuple([z.number(), z.number()])) })
  .meta({ id: "GeoLineString", description: "GeoJSON LineString ([lng, lat])" });

export const DayPlanSchema = z
  .object({
    dayIndex: z.number().int(),
    title: z.string(),
    date: z.string().nullable(),
    weekday: z.string().nullable(),
    mode: TravelModeSchema,
    travelBasis: z.enum(["driving", "walking", "transit", "bicycling", "mixed", "estimated"]).meta({
      description: "실제 이동시간 산출 기준 (국내는 driving)",
    }),
    base: PointSchema,
    stops: z.array(PlannedStopSchema),
    returnTravelMins: z.number(),
    totals: z.object({ travelMins: z.number(), stayMins: z.number(), travelRatio: z.number() }),
    dayTripTown: z.string().nullable(),
    validation: z.object({ passed: z.boolean(), issues: z.array(ValidationIssueSchema) }),
    needsReview: z.boolean().meta({ description: "검증 재시도 후에도 실패 → '검증 필요'" }),
    attempts: z.number().int(),
  })
  .meta({ id: "DayPlan" });
export type DayPlanView = z.infer<typeof DayPlanSchema>;

export const NearbyTownDetailSchema = z
  .object({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    travelMins: z.number(),
    kind: z.enum(["dayTrip", "overnight"]),
    reason: z.string(),
  })
  .meta({ id: "NearbyTownDetail" });

export const TripMetaSchema = z
  .object({
    base: PointSchema.nullable(),
    countryCode: z.string().nullable(),
    travelBasisNotice: z.string().nullable(),
    notices: z.array(z.string()),
    warnings: z.array(z.string()),
    needsReviewDays: z.array(z.number().int()),
    partial: z.boolean(),
    cache: z.object({ hit: z.boolean(), cityRefreshedAt: z.string().nullable() }),
    usage: z.unknown().nullable(),
    nearbyTowns: z.array(NearbyTownDetailSchema).default([]),
  })
  .meta({ id: "TripMeta" });
export type TripMetaView = z.infer<typeof TripMetaSchema>;

export const CityBackgroundSchema = z
  .object({
    history: z.string().nullable(),
    culture: z.string().nullable(),
    bestTime: z.string().nullable(),
    etiquette: z.string().nullable(),
    sources: z.array(WebSourceSchema),
  })
  .meta({ id: "CityBackground" });

export const TourismInfoSchema = z
  .object({
    summary: z.string(),
    recommended: z.array(z.string()),
    festivals: z.array(z.string()),
    transitPasses: z.array(z.string()),
    sources: z.array(WebSourceSchema.extend({ official: z.boolean() })),
    searchQueries: z.array(z.string()),
    searchEntryPointHtml: z.string().nullable().meta({ description: "Google 검색 추천 HTML — 그라운딩 결과와 함께 표시해야 함" }),
  })
  .meta({ id: "TourismInfo" });

export const TripDaySchema = z
  .object({
    dayIndex: z.number().int(),
    title: z.string(),
    stops: DayPlanSchema.meta({ description: "일자 계획 전체 (방문 순서·시간·체류·이동·검증)" }),
    routeGeo: GeoLineStringSchema.nullable(),
  })
  .meta({ id: "TripDay" });
export type TripDayView = z.infer<typeof TripDaySchema>;

export const NearbyTownSchema = z
  .object({ name: z.string(), travelMins: z.number().int(), reason: z.string() })
  .meta({ id: "NearbyTown" });

export const CitySummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    countryCode: z.string(),
    lat: z.number(),
    lon: z.number(),
  })
  .meta({ id: "CitySummary" });

export const TripDetailSchema = TripSummarySchema.extend({
  step: AgentStepSchema.nullable(),
  stepMessage: z.string().nullable(),
  errorMessage: z.string().nullable(),
  meta: TripMetaSchema.nullable().meta({
    description: "결과 메타: 숙소 거점, 이동시간 기준 안내(국내는 자동차 기준), 경고, 검증 필요 일자, 근교 도시 상세, 사용량",
  }),
  city: CitySummarySchema.nullable(),
  itinerary: z.array(TripDaySchema),
  nearbyTowns: z.array(NearbyTownSchema),
}).meta({ id: "TripDetail" });
export type TripDetail = z.infer<typeof TripDetailSchema>;

export const PoiSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    category: z.string(),
    lat: z.number(),
    lon: z.number(),
    hours: z.array(z.string()).nullable(),
    sourceUrl: z.string().nullable(),
  })
  .meta({ id: "Poi" });

export const CityDetailSchema = CitySummarySchema.extend({
  background: CityBackgroundSchema.nullable(),
  tourismBoard: TourismInfoSchema.nullable(),
  refreshedAt: isoDateTime,
  pois: z.array(PoiSchema),
}).meta({ id: "CityDetail" });
export type CityDetail = z.infer<typeof CityDetailSchema>;

export const ProgressEventSchema = z
  .object({
    tripId: z.uuid(),
    status: TripStatusSchema,
    step: AgentStepSchema,
    message: z.string().meta({ example: "관광청 정보를 조사하는 중" }),
    progress: z.number().int().min(0).max(100),
    errorMessage: z.string().nullable(),
  })
  .meta({ id: "ProgressEvent", description: "SSE `event: progress`의 data" });
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

export const RegenerateDayResponseSchema = z
  .object({
    tripId: z.uuid(),
    dayIndex: z.number().int(),
    status: TripStatusSchema,
    eventsUrl: z.string(),
  })
  .meta({ id: "RegenerateDayResponse" });

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    db: z.enum(["ok", "skipped"]),
    time: isoDateTime,
  })
  .meta({ id: "HealthResponse" });
