import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL } from "./e2e/db-url";

const PORT = 3100;

// 웹서버보다 먼저 E2E 전용 DB를 준비한다. 설정 파일은 워커 프로세스에서도 다시 로드되므로 메인 프로세스에서만 실행
if (!process.env.TEST_WORKER_INDEX) {
  execSync("npx tsx scripts/e2e-prepare-db.ts", { env: { ...process.env, E2E_DATABASE_URL }, stdio: "inherit" });
}

/**
 * E2E: 실제 Next 서버 + 로컬 SQL Server의 E2E 전용 DB(trippilot_e2e) + 외부 API는 MSW 목 (E2E_MOCK_EXTERNALS=1).
 * 사전 준비: npm run db:up (DB 생성·마이그레이션·초기화는 scripts/e2e-prepare-db.ts가 한다)
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: {
    // 운영 컨테이너와 같은 standalone server.js로 띄운다
    command: `npm run build && node scripts/start-standalone.mjs`,
    url: `http://localhost:${PORT}/api/healthz?shallow=1`,
    // 항상 새로 띄운다 (E2E 전용 DB·목 모드 환경변수가 반드시 적용되도록)
    reuseExistingServer: false,
    timeout: 300_000,
    env: { E2E_MOCK_EXTERNALS: "1", DAILY_TRIP_LIMIT: "1000", DATABASE_URL: E2E_DATABASE_URL, PORT: String(PORT) },
  },
});
