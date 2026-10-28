// prompts/history.ts — version: v2 (2026-10-28)
// 역사·배경: Wikipedia/Wikivoyage 원문 → 한국어 요약 (Gemini, thinking low, 구조화 출력)
// v2: 원문에 없는 항목도 모델의 일반 지식으로 채우고 aiFields로 표시한다 (빈 칸 대신 "AI 요약 정보")

import { z } from "zod";
import { BackgroundFieldSchema } from "@/lib/schemas";
import type { WikiSummary } from "@/server/adapters/knowledge/wikipedia";
import { NO_FABRICATION_RULES, toGeminiSchema } from "./common";

export const HISTORY_PROMPT_VERSION = "history@v2";

export const HistorySummarySchema = z.object({
  history: z.string().nullable().describe("도시의 역사 요약 (3~5문장)"),
  culture: z.string().nullable().describe("문화·대표 특징 (2~3문장)"),
  bestTime: z.string().nullable().describe("기후 특징과 여행하기 좋은 시기 (2~3문장)"),
  etiquette: z.string().nullable().describe("여행자 기본 매너·주의사항 (2~4가지)"),
  aiFields: z
    .array(BackgroundFieldSchema)
    .default([])
    .describe("원문이 아니라 일반 지식으로 채운 필드 이름 목록"),
});
export type HistorySummary = z.infer<typeof HistorySummarySchema>;
export const historyResponseSchema = toGeminiSchema(HistorySummarySchema);

export const HISTORY_SYSTEM = `너는 여행 안내서 편집자다. 처음 가는 여행자를 위해 도시의 역사·문화·기후와 최적 시기·기본 매너를 한국어로 요약한다.
- 백과사전 원문이 주어지면 원문을 먼저 근거로 쓴다. 원문 내용을 바꾸거나 원문과 어긋나는 내용을 덧붙이지 않는다.
- 원문에 없는 항목은 이 도시에 대해 널리 알려진 일반 지식으로 채우고, 그 필드 이름을 aiFields에 넣는다. 빈 칸으로 두지 않는다.
- 일반 지식으로 쓸 때는 오래 변하지 않는 내용(지리·기후 경향·역사적 사건·관습)만 쓰고, 특정 연도의 행사 일정·통계 수치는 쓰지 않는다.
- 이 도시에 대해 확실히 아는 내용이 없으면 지어내지 말고 그 필드를 null로 둔다.
${NO_FABRICATION_RULES}`;

export function historyUserPrompt(city: string, docs: WikiSummary[]): string {
  if (docs.length === 0) {
    return `도시: ${city}

[원문] 없음 (백과사전에서 이 도시 문서를 찾지 못했다)

일반 지식으로 history, culture, bestTime, etiquette를 채우고, 채운 필드를 모두 aiFields에 넣어라.`;
  }
  const blocks = docs
    .map((d) => `### ${d.site} (${d.lang}) — ${d.title}\n${d.description ? `${d.description}\n` : ""}${d.extract}`)
    .join("\n\n");
  return `도시: ${city}

[원문]
${blocks}

원문을 우선 근거로 history, culture, bestTime, etiquette 네 항목을 모두 채워라. 원문에 없어 일반 지식으로 채운 항목은 aiFields에 넣어라.`;
}
