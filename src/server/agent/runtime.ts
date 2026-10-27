/**
 * 운영 환경 의존성 조립과 작업 시작. Route Handler는 여기의 start* 함수로 작업을 띄우고 즉시 202를 반환한다.
 */
import { getEnv } from "@/lib/env";
import { WikipediaKnowledge } from "@/server/adapters/knowledge/wikipedia";
import { GeminiProvider } from "@/server/adapters/llm/gemini";
import { getMapsProvider, GoogleMapsProvider } from "@/server/adapters/maps";
import { GeminiGoogleSearch } from "@/server/adapters/search/geminiGoogleSearch";
import { agentStore } from "@/server/db/agentStore";
import { tripRepo } from "@/server/db";
import { runDayRegeneration, runTripJob } from "./orchestrator";
import type { AgentDeps } from "./types";

/** running/queued 상태로 이 시간 이상 갱신이 없으면 멈춘 작업으로 본다 */
export const STALE_JOB_MINUTES = 10;

let defaults: AgentDeps | undefined;

export function getDefaultDeps(): AgentDeps {
  if (defaults) return defaults;
  const env = getEnv();
  defaults = {
    store: agentStore,
    llm: new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    search: new GeminiGoogleSearch({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    geocoder: new GoogleMapsProvider({ serverKey: env.GOOGLE_MAPS_SERVER_KEY }),
    mapsFor: getMapsProvider,
    wiki: new WikipediaKnowledge(),
  };
  return defaults;
}

/** 작업을 백그라운드로 시작한다 (응답을 기다리게 하지 않음). 결과·오류는 DB 상태로 남는다 */
export function startTripJob(tripId: string, deps: AgentDeps = getDefaultDeps()): void {
  void runTripJob(tripId, deps).catch((e) => console.error(`[agent] trip ${tripId} crashed`, e));
}

export function startDayRegeneration(tripId: string, dayIndex: number, deps: AgentDeps = getDefaultDeps()): void {
  void runDayRegeneration(tripId, dayIndex, deps).catch((e) => console.error(`[agent] trip ${tripId} day ${dayIndex} crashed`, e));
}

/**
 * 서버 재시작 등으로 멈춘 작업 정리 (src/instrumentation.ts에서 기동 시 실행).
 * 다른 복제본에서 진행 중인 작업은 계속 updatedAt을 갱신하므로 영향받지 않는다.
 */
export async function cleanupStaleJobs(now = new Date()): Promise<number> {
  const count = await tripRepo.failStale(new Date(now.getTime() - STALE_JOB_MINUTES * 60_000));
  if (count) console.warn(`[agent] ${count}건의 멈춘 작업을 failed로 정리했습니다.`);
  return count;
}
