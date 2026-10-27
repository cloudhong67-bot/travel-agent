import { CityIdParamsSchema } from "@/lib/schemas";
import { badRequest, notFound, withErrorHandling } from "@/server/api/respond";
import { cityRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/cities/{id} — 도시 기초정보(역사·관광청·POI) */
export const GET = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const parsed = CityIdParamsSchema.safeParse(await params);
  if (!parsed.success) return badRequest(parsed.error);

  const city = await cityRepo.getDetail(parsed.data.id);
  return city ? Response.json(city) : notFound("도시");
});
