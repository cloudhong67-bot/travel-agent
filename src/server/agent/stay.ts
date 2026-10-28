/**
 * 추천 체류 일수 (순수 함수, LLM 미사용 — 같은 도시면 같은 답).
 * 도시 규모는 수집한 "볼거리" 양으로 본다: 명소·박물관 수(식당은 어느 날에나 끼울 수 있어 제외)를
 * 하루 방문 가능 수로 나누고, 당일치기 근교 도시가 있으면 하루를 더한다.
 */
import type { RecommendedStay } from "@/lib/schemas";
import type { AgentPoi, NearbyTown } from "./types";

/** 하루에 무리 없이 볼 수 있는 명소 수 (대체 배분 FALLBACK_STOPS_PER_DAY와 같은 기준) */
export const SIGHTS_PER_DAY = 4;
/** 도시 안 일정 최소·최대 일수 */
const CITY_DAYS = { min: 2, max: 5 } as const;
/** 전체 추천 일수 상한 (생성 요청의 days 상한 14보다 보수적으로) */
const MAX_DAYS = 7;

export function recommendStay(pois: Pick<AgentPoi, "category" | "origin">[], nearby: Pick<NearbyTown, "kind">[]): RecommendedStay {
  const sights = pois.filter((p) => p.category === "sight" || p.category === "museum").length;
  const raw = Math.ceil(sights / SIGHTS_PER_DAY);
  const cityDays = Math.min(CITY_DAYS.max, Math.max(CITY_DAYS.min, raw));
  // 근교는 하루만 권한다 (여러 곳은 1박 이동이 낫다 — 근교 탭에서 안내)
  const dayTrip = nearby.some((t) => t.kind === "dayTrip") ? 1 : 0;
  const days = Math.min(MAX_DAYS, cityDays + dayTrip);

  const cityPart =
    raw === cityDays
      ? `주요 명소·박물관 ${sights}곳(하루 ${SIGHTS_PER_DAY}곳 기준 ${cityDays}일)`
      : raw < cityDays
        ? `주요 명소·박물관 ${sights}곳 — 도시 일정 최소 ${cityDays}일`
        : `주요 명소·박물관 ${sights}곳 — 핵심만 골라 ${cityDays}일`;
  return {
    days,
    nights: days - 1,
    reason: dayTrip ? `${cityPart} + 근교 당일치기 1일` : cityPart,
  };
}
