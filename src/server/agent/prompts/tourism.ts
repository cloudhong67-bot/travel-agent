// prompts/tourism.ts — version: v2 (2026-10-28)
// 관광청 조사: Gemini Google 검색 그라운딩 질의문. 검색 도구 응답은 구조화 출력을 쓸 수 없어
// 고정된 줄 머리표("추천명소:" 등)로 형식을 지정하고 parseTourismAnswer로 해석한다.
// v2: 공식 관광청 정보가 부족한 소도시용 대체 출처 질의(alternativeTourismQuery) 추가

import { FACT_RULES } from "./common";

export const TOURISM_PROMPT_VERSION = "tourism@v2";

const ANSWER_FORMAT = (siteLabel: string) => `아래 형식을 정확히 지켜 답하라 (각 머리표는 한 줄, 항목 구분은 세미콜론):
요약: <도시 소개 2~4문장>
공식사이트: <${siteLabel}; 없으면 정보 없음>
추천명소: <추천 명소 이름 최대 8개; 원어 이름>
축제: <축제명(시기) 최대 5개; 없으면 정보 없음>
교통패스: <패스명 — 출처에 있는 가격·조건만; 없으면 정보 없음>`;

/** PRD 7장 질의: "<국가> 공식 관광청 <도시> 명소 축제 교통패스" + 출력 형식 */
export function tourismQuery(countryName: string, city: string): string {
  return `${countryName} 공식 관광청 ${city} 명소 축제 교통패스

국가·도시의 공식 관광청 사이트를 우선 찾아, 그 사이트가 소개하는 내용을 정리해라.
${FACT_RULES}
${ANSWER_FORMAT("공식 관광청 URL")}`;
}

/**
 * 공식 관광청이 없거나 정보가 부족한 도시(소도시 등)용 대체 출처 질의.
 * 신뢰도 순으로 위키여행 → 지자체·관광안내소·문화원 → 대형 여행 정보 플랫폼·Google 여행 가이드를 쓰게 한다.
 */
export function alternativeTourismQuery(countryName: string, city: string): string {
  return `${city} ${countryName} 여행 가이드 명소 축제 교통 위키여행 Wikivoyage

이 도시는 공식 관광청 정보가 없거나 부족하다. 다음 대체 출처를 신뢰도 순으로 찾아 여행 정보를 정리해라:
1) 위키여행(Wikivoyage)의 이 도시 문서
2) 시청·지자체 관광과, 현지 관광안내소, 현지 문화원
3) 론리플래닛·트립어드바이저 같은 대형 여행 정보 플랫폼, Google 여행 가이드
개인 블로그·광고성 글은 근거로 쓰지 않는다.
${FACT_RULES}
${ANSWER_FORMAT("지자체·관광안내소 공식 URL")}`;
}

/** 첫 검색(공식 관광청)으로는 부족해 대체 출처를 더 찾아야 하는지: 공식 사이트가 없거나 추천 명소가 2곳 미만 */
export function needsAlternativeSources(p: ParsedTourism): boolean {
  return !p.officialSite || p.recommended.length < 2;
}

export interface ParsedTourism {
  summary: string;
  officialSite: string | null;
  recommended: string[];
  festivals: string[];
  transitPasses: string[];
}

const NONE = /^(정보\s*없음|없음|n\/a|none|-)$/i;

function field(text: string, label: string): string | null {
  // 모델이 마크다운 굵게(**요약:**)나 글머리표를 붙여도 해석한다
  const m = text.match(new RegExp(`^\\s*[*-]?\\s*\\**${label}\\**\\s*[:：]\\s*\\**(.+)$`, "m"));
  const v = m?.[1].replace(/\*\*/g, "").trim();
  return v && !NONE.test(v) ? v : null;
}

const list = (v: string | null) =>
  (v ?? "")
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter((s) => s && !NONE.test(s));

/** 형식이 어긋나도 요약은 원문 전체로 남긴다 */
export function parseTourismAnswer(text: string): ParsedTourism {
  return {
    summary: field(text, "요약") ?? text.trim(),
    officialSite: field(text, "공식사이트")?.match(/https?:\/\/\S+/)?.[0] ?? null,
    recommended: list(field(text, "추천명소")).slice(0, 8),
    festivals: list(field(text, "축제")),
    transitPasses: list(field(text, "교통패스")),
  };
}
