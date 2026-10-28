import { RescheduleTripRequestSchema, TripIdParamsSchema } from "@/lib/schemas";
import { startReschedule } from "@/server/agent/runtime";
import { apiError, notFound, parseInput, readJson, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

const CLAIM_ERRORS = {
  busy: () => apiError(409, "CONFLICT", "이 여행은 이미 작업 중입니다. 완료 후 다시 시도하세요."),
  failed: () => apiError(409, "CONFLICT", "생성에 실패한 여행은 일정을 조정할 수 없습니다. 여행을 새로 만드세요."),
  notFound: () => notFound("여행"),
} as const;

/**
 * POST /api/v1/trips/{id}/reschedule — 일정 조정: 여행 일수·출발일을 바꾸고 사용자 요청을 반영해 일정 전체를 다시 만든다.
 * 도시·근교 정보는 재사용하고 배분·최적화·검증(4~6단계)만 다시 돈다. 백그라운드로 실행하고 즉시 202.
 * 새 일정이 완성될 때까지 기존 일정·일수는 그대로 남는다 (실패하면 기존 일정 유지).
 */
export const POST = withErrorHandling(async (request: Request, { params }: Ctx) => {
  const { id } = parseInput(TripIdParamsSchema, await params);
  const input = parseInput(RescheduleTripRequestSchema, await readJson(request));

  const claim = await tripRepo.claimForReschedule(id, input.days);
  if (claim !== "ok") return CLAIM_ERRORS[claim]();

  startReschedule(id, input);
  return Response.json(
    { tripId: id, days: input.days, status: "running", eventsUrl: `/api/v1/trips/${id}/events` },
    { status: 202 },
  );
});
