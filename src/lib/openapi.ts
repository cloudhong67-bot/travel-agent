import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  ApiErrorSchema,
  CityDetailSchema,
  CityIdParamsSchema,
  CreateTripRequestSchema,
  CreateTripResponseSchema,
  DayParamsSchema,
  HealthResponseSchema,
  ListTripsQuerySchema,
  ProgressEventSchema,
  RegenerateDayResponseSchema,
  RescheduleTripRequestSchema,
  RescheduleTripResponseSchema,
  TripDetailSchema,
  TripIdParamsSchema,
  TripListResponseSchema,
} from "./schemas";

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorSchema, description);

const unauthorized = { 401: error("접근 토큰 없음·불일치") };

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();

  const bearer = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "APP_ACCESS_TOKEN. 브라우저는 /unlock에서 설정되는 httpOnly 쿠키(tp_access)로 대체 가능",
  });
  const security = [{ [bearer.name]: [] }];

  registry.registerPath({
    method: "post",
    path: "/api/v1/trips",
    summary: "일정 생성 작업 시작",
    security,
    request: { body: { content: { "application/json": { schema: CreateTripRequestSchema } } } },
    responses: {
      202: json(CreateTripResponseSchema, "작업 접수"),
      400: error("입력 검증 실패"),
      ...unauthorized,
      429: error("하루 생성 한도(DAILY_TRIP_LIMIT) 초과"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/trips",
    summary: "저장된 여행 목록 (최신순, 커서 페이지네이션)",
    security,
    request: { query: ListTripsQuerySchema },
    responses: { 200: json(TripListResponseSchema, "목록"), 400: error("쿼리 검증 실패"), ...unauthorized },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/trips/{id}",
    summary: "일정·동선·근교도시 상세",
    security,
    request: { params: TripIdParamsSchema },
    responses: { 200: json(TripDetailSchema, "상세"), 404: error("없음"), ...unauthorized },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/trips/{id}",
    summary: "여행 삭제",
    security,
    request: { params: TripIdParamsSchema },
    responses: { 204: { description: "삭제됨" }, 404: error("없음"), ...unauthorized },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/trips/{id}/events",
    summary: "진행 상황 SSE 스트림",
    description:
      "`event: progress` 마다 data에 ProgressEvent JSON. status가 done/failed가 되면 서버가 스트림을 닫는다.",
    security,
    request: { params: TripIdParamsSchema },
    responses: {
      200: {
        description: "text/event-stream",
        content: { "text/event-stream": { schema: ProgressEventSchema } },
      },
      404: error("없음"),
      ...unauthorized,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/trips/{id}/days/{dayIndex}/regenerate",
    summary: "특정 일자 재생성 (배분·최적화·검증 재실행)",
    description: "백그라운드로 실행하고 즉시 202. 진행은 /events SSE로 확인한다. 다른 일자에 쓴 명소는 피한다.",
    security,
    request: { params: DayParamsSchema },
    responses: {
      202: json(RegenerateDayResponseSchema, "재생성 시작"),
      400: error("dayIndex 범위 오류"),
      404: error("없음"),
      409: error("이미 작업 중이거나 생성에 실패한 여행"),
      ...unauthorized,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/trips/{id}/reschedule",
    summary: "일정 조정 (일수·출발일 변경 + 요청 반영, 일정 전체 재작성)",
    description:
      "도시·근교 정보는 재사용하고 배분·최적화·검증만 다시 돈다. 백그라운드로 실행하고 즉시 202, 진행은 /events SSE. 새 일정이 완성될 때까지 기존 일정이 유지되고, 실패하면 기존 일정을 그대로 둔다. 추천 일수는 TripDetail.meta.recommendedStay.",
    security,
    request: {
      params: TripIdParamsSchema,
      body: { content: { "application/json": { schema: RescheduleTripRequestSchema } } },
    },
    responses: {
      202: json(RescheduleTripResponseSchema, "일정 조정 시작"),
      400: error("검증 오류"),
      404: error("없음"),
      409: error("이미 작업 중이거나 생성에 실패한 여행"),
      ...unauthorized,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/cities/{id}",
    summary: "도시 기초정보(역사·관광청·POI)",
    security,
    request: { params: CityIdParamsSchema },
    responses: { 200: json(CityDetailSchema, "도시"), 404: error("없음"), ...unauthorized },
  });

  registry.registerPath({
    method: "get",
    path: "/api/healthz",
    summary: "상태 프로브 (인증 제외)",
    description: "`?shallow=1`이면 DB를 확인하지 않는다 (Azure SQL 자동 일시중지를 깨우지 않기 위한 liveness용).",
    request: { query: z.object({ shallow: z.enum(["1"]).optional() }) },
    responses: { 200: json(HealthResponseSchema, "정상"), 503: error("DB 연결 실패") },
  });

  return registry;
}

let cached: ReturnType<OpenApiGeneratorV31["generateDocument"]> | undefined;

export function getOpenApiDocument() {
  cached ??= new OpenApiGeneratorV31(buildRegistry().definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "TripPilot API",
      version: "0.1.0",
      description: "여행 도시 맞춤형 AI 에이전트. 날짜는 모두 ISO 8601, 오류는 { code, message }.",
    },
    servers: [{ url: "/" }],
  });
  return cached;
}
