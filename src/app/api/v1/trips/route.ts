import { pickEnv } from "@/lib/env";
import { CreateTripRequestSchema, ListTripsQuerySchema } from "@/lib/schemas";
import { startTripJob } from "@/server/agent/runtime";
import { apiError, badRequest, readJson, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

/** POST /api/v1/trips — 일정 생성 작업 시작. 에이전트는 백그라운드로 돌고 즉시 202를 반환한다 */
export const POST = withErrorHandling(async (request: Request) => {
  const parsed = CreateTripRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return badRequest(parsed.error);

  const { DAILY_TRIP_LIMIT } = pickEnv(["DAILY_TRIP_LIMIT"]);
  const result = await tripRepo.createWithDailyLimit(parsed.data, { limit: DAILY_TRIP_LIMIT });
  if (!result.ok) {
    return apiError(
      429,
      "DAILY_LIMIT_EXCEEDED",
      `오늘 생성 한도(${result.limit}건)를 모두 사용했습니다. 내일(한국 시간 자정 이후) 다시 시도하세요.`,
    );
  }

  const tripId = result.trip.id;
  startTripJob(tripId);

  return Response.json(
    { tripId, status: result.trip.status, eventsUrl: `/api/v1/trips/${tripId}/events` },
    { status: 202, headers: { Location: `/api/v1/trips/${tripId}` } },
  );
});

/** GET /api/v1/trips — 목록 */
export const GET = withErrorHandling(async (request: Request) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = ListTripsQuerySchema.safeParse(params);
  if (!parsed.success) return badRequest(parsed.error);
  return Response.json(await tripRepo.list(parsed.data));
});
