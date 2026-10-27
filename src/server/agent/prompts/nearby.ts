// prompts/nearby.ts — version: v1 (2026-10-27)
// 근교 소도시: (1) 후보 지명 제안 → 코드가 지오코딩·거리(150km)·이동시간(120분)으로 걸러냄 → (2) 스타일 적합도로 선정

import { z } from "zod";
import { FACT_RULES, toGeminiSchema } from "./common";

export const NEARBY_PROMPT_VERSION = "nearby@v1";

// ---- (1) 후보 ----

export const NearbyCandidatesSchema = z.object({
  towns: z
    .array(
      z.object({
        name: z.string().describe("한국어 표기 지명"),
        localName: z.string().describe("현지어(원어) 지명 — 지오코딩에 사용"),
      }),
    )
    .max(10),
});
export const nearbyCandidatesResponseSchema = toGeminiSchema(NearbyCandidatesSchema);

export const NEARBY_CANDIDATES_SYSTEM = `너는 여행 지리 전문가다. 실제로 존재하는 지명만 답한다.
${FACT_RULES}`;

export function nearbyCandidatesPrompt(city: string, countryName: string, lat: number, lon: number): string {
  return `거점 도시: ${city} (${countryName}, 좌표 ${lat.toFixed(4)}, ${lon.toFixed(4)})
거점에서 직선 150km 이내에 있는, 여행자가 당일치기나 1박으로 다녀올 만한 소도시·관광 도시 후보를 최대 10곳 제시하라.
거점 도시 자신과 거점 도시의 구(區)·동네는 제외한다. 좌표·거리는 쓰지 말고 이름만 답한다(코드가 직접 확인한다).`;
}

// ---- (2) 선정 ----

export const NearbySelectionSchema = z.object({
  selected: z
    .array(
      z.object({
        name: z.string().describe("후보 목록에 있는 이름 그대로"),
        reason: z.string().describe("여행 스타일과 맞는 이유 1~2문장. 후보 정보에 없는 사실(운영시간·가격)은 쓰지 않는다"),
      }),
    )
    .min(0)
    .max(5),
});
export const nearbySelectionResponseSchema = toGeminiSchema(NearbySelectionSchema);

export const NEARBY_SELECT_SYSTEM = `너는 여행 플래너다. 주어진 후보 목록 안에서만 고른다.
${FACT_RULES}`;

export function nearbySelectPrompt(
  city: string,
  style: string,
  candidates: { name: string; travelMins: number; distanceKm: number }[],
): string {
  const lines = candidates.map((c) => `- ${c.name}: 편도 약 ${c.travelMins}분, 직선 ${c.distanceKm}km`).join("\n");
  return `거점: ${city}
여행 스타일: ${style}
후보(모두 편도 120분 이내로 확인됨):
${lines}

여행 스타일에 잘 맞는 곳을 2~5곳 골라 이유를 써라. 후보가 2곳 미만이면 있는 만큼만 고른다.`;
}
