/**
 * Next.js 서버 기동 시 1회 실행.
 *  - APPLICATIONINSIGHTS_CONNECTION_STRING이 있으면 Azure Monitor(OpenTelemetry)로 요청·외부 API·에이전트 단계 span을 보낸다.
 *    없으면 아무것도 등록하지 않아 계측 코드(src/server/telemetry.ts)는 no-op이 된다.
 *  - 이전 프로세스가 내려가며 남긴 running/queued 작업을 failed로 정리한다
 *    (ACA 최소 복제본 0 → 유휴 후 재기동 시 진행 중이던 작업은 이어서 실행할 수 없다)
 *  - E2E_MOCK_EXTERNALS=1이면 외부 API를 MSW 목으로 대체한다 (Playwright E2E 전용)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await startTelemetry();

  if (process.env.E2E_MOCK_EXTERNALS === "1") {
    const { startE2EMocks } = await import("@/test/msw/e2e");
    startE2EMocks();
  }

  if (!process.env.DATABASE_URL) return; // 빌드·DB 미설정 환경
  try {
    const { cleanupStaleJobs } = await import("@/server/agent/runtime");
    await cleanupStaleJobs();
  } catch (error) {
    // DB가 일시중지 상태여도 서버 기동은 막지 않는다
    console.error("[instrumentation] stale job cleanup failed", error);
  }
}

async function startTelemetry() {
  const { pickEnv } = await import("@/lib/env");
  const { APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString } = pickEnv(["APPLICATIONINSIGHTS_CONNECTION_STRING"]);
  if (!connectionString) return;
  try {
    // React 훅이 아니라 Azure SDK 함수 이름이 use로 시작할 뿐이므로 별칭으로 가져온다
    const { useAzureMonitor: enableAzureMonitor } = await import("@azure/monitor-opentelemetry");
    enableAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      // 들어오는 요청(http 서버)·Azure SDK 호출. 외부 fetch 호출은 에이전트 계측 래퍼가 span을 만든다
      instrumentationOptions: { http: { enabled: true }, azureSdk: { enabled: true } },
      // 1인 서비스라 전량 수집해도 Log Analytics 무료 한도(월 5GB) 안이다
      samplingRatio: 1,
    });
    console.log("[telemetry] Azure Monitor 활성화");
  } catch (error) {
    console.error("[telemetry] Azure Monitor 초기화 실패 — 원격 측정 없이 계속합니다", error);
  }
}
