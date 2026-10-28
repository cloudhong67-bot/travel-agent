import { getOpenApiDocument } from "@/lib/openapi";
import { withErrorHandling } from "@/server/api/respond";

/** GET /api/v1/openapi.json — src/lib/schemas.ts에서 생성한 OpenAPI 3.1 문서 */
export const GET = withErrorHandling(() => Response.json(getOpenApiDocument()));
