import { TripIdParamsSchema } from "@/lib/schemas";
import { badRequest, notFound, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/trips/{id} — 상세 */
export const GET = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const parsed = TripIdParamsSchema.safeParse(await params);
  if (!parsed.success) return badRequest(parsed.error);

  const trip = await tripRepo.getDetail(parsed.data.id);
  return trip ? Response.json(trip) : notFound("여행");
});

/** DELETE /api/v1/trips/{id} — 삭제 (204) */
export const DELETE = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const parsed = TripIdParamsSchema.safeParse(await params);
  if (!parsed.success) return badRequest(parsed.error);

  const deleted = await tripRepo.delete(parsed.data.id);
  return deleted ? new Response(null, { status: 204 }) : notFound("여행");
});
