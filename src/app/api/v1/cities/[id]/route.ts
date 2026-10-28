import { CityIdParamsSchema } from "@/lib/schemas";
import { notFound, parseInput, withErrorHandling } from "@/server/api/respond";
import { cityRepo } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/cities/{id} — 도시 기초정보(역사·관광청·POI) */
export const GET = withErrorHandling(async (_request: Request, { params }: Ctx) => {
  const { id } = parseInput(CityIdParamsSchema, await params);
  const city = await cityRepo.getDetail(id);
  return city ? Response.json(city) : notFound("도시");
});
