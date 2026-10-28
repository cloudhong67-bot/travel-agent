import { TripIdParamsSchema } from "@/lib/schemas";
import { notFound, parseInput, withErrorHandling } from "@/server/api/respond";
import { tripRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/trips/{id} — 상세 */
export const GET = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const { id } = parseInput(TripIdParamsSchema, await params);
  const trip = await tripRepo.getDetail(id);
  return trip ? Response.json(trip) : notFound("여행");
});

/** DELETE /api/v1/trips/{id} — 삭제 (204) */
export const DELETE = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const { id } = parseInput(TripIdParamsSchema, await params);
  return (await tripRepo.delete(id)) ? new Response(null, { status: 204 }) : notFound("여행");
});
