// prompts/assignment.ts — version: v3 (2026-10-28) — v2: 예산 수준 반영, v3: 사용자 요청(일정 조정) 반영
// 일자 배분: Gemini(thinking medium) 함수 호출 submitItinerary. 인자는 Zod 스키마(AssignmentSchema)로 강제·검증.
// "주어진 POI 키만 사용" 규칙은 이 프롬프트와 assign.ts의 검증 양쪽에 있다.

import { z } from "zod";
import { FACT_RULES, toGeminiSchema } from "./common";

export const ASSIGNMENT_PROMPT_VERSION = "assignment@v3";

const BUDGET_LABEL = { low: "알뜰 (무료·저렴한 명소와 현지 식당 위주)", medium: "보통", high: "여유 (유료 명소·평점 높은 식당 우선)" } as const;
export const ASSIGNMENT_TOOL_NAME = "submitItinerary";

export const AssignmentSchema = z.object({
  days: z.array(
    z.object({
      dayIndex: z.number().int().min(0).describe("0부터 시작하는 일자 번호"),
      title: z.string().max(60).describe("그날의 주제 (예: 리베이라 강변과 구시가지)"),
      dayTripTown: z.string().nullable().describe("근교 당일치기 일자면 근교 도시 이름 그대로, 아니면 null"),
      stops: z
        .array(
          z.object({
            poiKey: z.string().describe("주어진 목록의 키(P01 형식)만 사용"),
            stayMins: z.number().int().min(20).max(240).describe("권장 체류 시간(분)"),
          }),
        )
        .max(8),
    }),
  ),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const assignmentTool = {
  name: ASSIGNMENT_TOOL_NAME,
  description: "완성된 일자별 방문지 배분을 제출한다. 반드시 이 함수를 정확히 한 번 호출해 답한다.",
  parameters: toGeminiSchema(AssignmentSchema),
};
export const assignmentResponseSchema = toGeminiSchema(AssignmentSchema);

export const ASSIGNMENT_SYSTEM = `너는 여행 일정 플래너다. 주어진 방문지(POI)를 일자별로 나눈다. 방문 순서와 이동시간은 코드가 계산하므로 너는 "어느 날에 무엇을" 만 정한다.
규칙:
1. 반드시 주어진 목록의 POI 키(P01 형식)만 사용한다. 목록에 없는 장소·키를 만들면 그 항목은 버려진다.
2. 한 POI는 전체 일정에서 한 번만 쓴다.
3. 하루 3~6곳, 서로 가까운 장소끼리 묶는다(좌표 참고). 하루 이동시간이 체류시간의 40%를 넘지 않게 한다.
4. 휴무 요일이 표시된 장소는 그 요일에 배치하지 않는다.
5. 식당(food)은 하루 1~2곳, 점심·저녁 시간대에 어울리게 넣는다.
6. 근교 도시가 주어지고 여행이 3일 이상이면 그중 하나를 별도 일자(dayTripTown)로 배정할 수 있다. 그 날의 stops는 비운다.
7. 여행 스타일에 맞는 장소를 우선한다.
${FACT_RULES}
결과는 반드시 ${ASSIGNMENT_TOOL_NAME} 함수를 호출해 제출한다.`;

export interface AssignmentPoiLine {
  key: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  closed: string | null;
  rating?: number;
}

export function assignmentUserPrompt(input: {
  city: string;
  style: string;
  transport: string;
  budget: keyof typeof BUDGET_LABEL | null;
  days: { dayIndex: number; date: string | null; weekday: string | null }[];
  pois: AssignmentPoiLine[];
  nearbyTowns: { name: string; travelMins: number }[];
  /** 재시도·재생성 시 해당 일자만 다시 짤 때의 피드백 */
  feedback?: string;
  /** 사용자가 일정 조정 때 적은 요청 (예: 둘째 날은 미술관 위주) */
  userRequest?: string;
}): string {
  const dayLines = input.days
    .map((d) => `- day ${d.dayIndex}${d.date ? `: ${d.date} (${d.weekday}요일)` : " (날짜 미정)"}`)
    .join("\n");
  const poiLines = input.pois
    .map(
      (p) =>
        `${p.key} | ${p.name} | ${p.category} | ${p.lat.toFixed(4)},${p.lon.toFixed(4)} | 휴무: ${p.closed ?? "정보 없음"}${p.rating ? ` | ★${p.rating}` : ""}`,
    )
    .join("\n");
  const towns = input.nearbyTowns.length
    ? input.nearbyTowns.map((t) => `- ${t.name} (편도 약 ${t.travelMins}분)`).join("\n")
    : "(없음)";

  return `도시: ${input.city}
여행 스타일: ${input.style}
이동수단: ${input.transport}
예산 수준: ${input.budget ? BUDGET_LABEL[input.budget] : "지정 안 함"} (가격 정보는 목록에 없으므로 장소 종류·평점으로만 판단한다)
배분할 일자:
${dayLines}

POI 목록 (키 | 이름 | 분류 | 좌표 | 휴무 요일 | 평점):
${poiLines}

근교 도시:
${towns}
${input.feedback ? `\n이전 배분의 문제점 — 반드시 고쳐라:\n${input.feedback}\n` : ""}${input.userRequest ? `\n사용자 요청 — 가능한 한 반영하라 (위 규칙·주어진 POI 키 제한과 충돌하면 규칙이 우선):\n${input.userRequest}\n` : ""}
위 일자에 대해서만 배분해 ${ASSIGNMENT_TOOL_NAME}로 제출하라.`;
}
