import { withTimeoutRetry } from "@/lib/http";
import { apiError, withErrorHandling } from "@/server/api/respond";
import { pingDb } from "@/server/db";

/** DB 확인이 이 시간을 넘으면 실패로 본다 (프로브 timeoutSeconds보다 짧게: 응답 자체가 늦어 프로브가 끊기지 않도록) */
const DB_CHECK_TIMEOUT_MS = 8_000;

/**
 * GET /api/healthz — 상태 프로브 (인증 제외, src/proxy.ts의 공개 경로)
 * 기본은 DB 연결까지 확인한다. `?shallow=1`은 DB를 건드리지 않으므로 ACA liveness 프로브에 쓴다
 * (주기적 DB 확인은 Azure SQL 서버리스 자동 일시중지를 막아 비용이 늘어난다).
 */
export const GET = withErrorHandling(async (request: Request) => {
  const shallow = new URL(request.url).searchParams.get("shallow") === "1";
  const time = new Date().toISOString();
  if (shallow) return Response.json({ status: "ok", db: "skipped", time });

  try {
    await withTimeoutRetry(() => pingDb(), { timeoutMs: DB_CHECK_TIMEOUT_MS, retries: 0 });
    return Response.json({ status: "ok", db: "ok", time });
  } catch (error) {
    console.error("[healthz] db check failed", error);
    return apiError(503, "DB_UNAVAILABLE", "데이터베이스에 연결할 수 없습니다.");
  }
});
