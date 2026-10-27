import { getOpenApiDocument } from "@/lib/openapi";

/** GET /api/v1/openapi.json — src/lib/schemas.ts에서 생성한 OpenAPI 3.1 문서 */
export function GET() {
  return Response.json(getOpenApiDocument());
}
