import { DayParamsSchema } from "@/lib/schemas";
import { startDayRegeneration } from "@/server/agent/runtime";
import { apiError, badRequest, notFound, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string; dayIndex: string }> };

/**
 * POST /api/v1/trips/{id}/days/{dayIndex}/regenerate — 해당 일자만 배분·최적화·검증(4~6단계) 재실행 (FR-11).
 * 작업은 백그라운드로 돌고 즉시 202. 진행은 /events SSE로 확인한다.
 */
export const POST = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const parsed = DayParamsSchema.safeParse(await params);
  if (!parsed.success) return badRequest(parsed.error);
  const { id, dayIndex } = parsed.data;

  const claim = await tripRepo.claimForRegeneration(id, dayIndex);
  if (claim === "notFound") return notFound("여행");
  if (claim === "badDay") return apiError(400, "VALIDATION_ERROR", `dayIndex는 여행 일수보다 작아야 합니다.`);
  if (claim === "busy") return apiError(409, "CONFLICT", "이 여행은 이미 작업 중입니다. 완료 후 다시 시도하세요.");
  if (claim === "failed") return apiError(409, "CONFLICT", "생성에 실패한 여행은 일자를 다시 만들 수 없습니다. 여행을 새로 만드세요.");

  startDayRegeneration(id, dayIndex);
  return Response.json(
    { tripId: id, dayIndex, status: "running", eventsUrl: `/api/v1/trips/${id}/events` },
    { status: 202 },
  );
});
