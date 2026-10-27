// prompts/history.ts — version: v1 (2026-10-27)
// 역사·배경: Wikipedia/Wikivoyage 원문 → 한국어 요약 (Gemini, thinking low, 구조화 출력)

import { z } from "zod";
import type { WikiSummary } from "@/server/adapters/knowledge/wikipedia";
import { FACT_RULES, toGeminiSchema } from "./common";

export const HISTORY_PROMPT_VERSION = "history@v1";

export const HistorySummarySchema = z.object({
  history: z.string().nullable().describe("도시의 역사 요약 (3~5문장)"),
  culture: z.string().nullable().describe("문화·대표 특징 (2~3문장)"),
  bestTime: z.string().nullable().describe("기후와 여행하기 좋은 시기. 원문에 없으면 null"),
  etiquette: z.string().nullable().describe("여행자 기본 매너·주의사항. 원문에 없으면 null"),
});
export type HistorySummary = z.infer<typeof HistorySummarySchema>;
export const historyResponseSchema = toGeminiSchema(HistorySummarySchema);

export const HISTORY_SYSTEM = `너는 여행 안내서 편집자다. 주어진 백과사전 원문만 사용해 여행자를 위한 한국어 요약을 만든다.
${FACT_RULES}
원문에 해당 주제가 없으면 그 필드는 null로 둔다. 원문을 번역·요약하되 새로운 사실을 덧붙이지 않는다.`;

export function historyUserPrompt(city: string, docs: WikiSummary[]): string {
  const blocks = docs
    .map((d) => `### ${d.site} (${d.lang}) — ${d.title}\n${d.description ? `${d.description}\n` : ""}${d.extract}`)
    .join("\n\n");
  return `도시: ${city}\n\n[원문]\n${blocks}\n\n위 원문만 근거로 history, culture, bestTime, etiquette를 채워라.`;
}
