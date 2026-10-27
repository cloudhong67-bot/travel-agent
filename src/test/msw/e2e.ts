/**
 * E2E "가짜 모드": Next 서버 프로세스 안에서 MSW로 외부 API(Gemini·Google 지도·Naver·Wikipedia)를 가로챈다.
 * src/instrumentation.ts가 E2E_MOCK_EXTERNALS=1일 때만 불러온다. DB는 실제(로컬 docker compose SQL Server)를 쓴다.
 * 브라우저에서 불러오는 지도 SDK(Google Maps JS·Naver Web Map)는 가로채지 않는다.
 */
import { setupServer } from "msw/node";
import { agentHandlers } from "./agentScenario";
import { handlers } from "./handlers";

export function startE2EMocks() {
  const server = setupServer(...agentHandlers({ geminiDelayMs: Number(process.env.E2E_GEMINI_DELAY_MS ?? 600) }).handlers, ...handlers);
  // 로컬 DB·Next 내부 요청 등 목이 없는 요청은 그대로 통과
  server.listen({ onUnhandledFrame: "bypass" });
  console.warn("[e2e] 외부 API 목(MSW) 활성화 — 운영에서 E2E_MOCK_EXTERNALS를 설정하지 마세요");
  return server;
}
