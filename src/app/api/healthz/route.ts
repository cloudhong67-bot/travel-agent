import { apiError } from "@/server/api/respond";
import { pingDb } from "@/server/db";

/**
 * GET /api/healthz — 상태 프로브 (인증 제외, src/proxy.ts의 공개 경로)
 * 기본은 DB 연결까지 확인한다. `?shallow=1`은 DB를 건드리지 않으므로 ACA liveness 프로브에 쓴다
 * (주기적 DB 확인은 Azure SQL 서버리스 자동 일시중지를 막아 비용이 늘어난다).
 */
export async function GET(request: Request) {
  const shallow = new URL(request.url).searchParams.get("shallow") === "1";
  const time = new Date().toISOString();
  if (shallow) return Response.json({ status: "ok", db: "skipped", time });

  try {
    await pingDb();
    return Response.json({ status: "ok", db: "ok", time });
  } catch (error) {
    console.error("[healthz] db check failed", error);
    return apiError(503, "DB_UNAVAILABLE", "데이터베이스에 연결할 수 없습니다.");
  }
}
